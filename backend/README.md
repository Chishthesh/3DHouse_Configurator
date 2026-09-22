# Configurator API

Backend for the 3D Extractor and 2D Image Configurator. ASP.NET Core **.NET 8**,
EF Core against **Azure SQL**, images and models in **Azure Blob Storage**, layer
render jobs dispatched through an **Azure Storage Queue**.

This is a separate repository from the frontend, as agreed. The frontend generates its
typed client from this project's OpenAPI document.

---

## Running locally

```bash
dotnet restore
dotnet ef database update --project src/Configurator.Api
dotnet run --project src/Configurator.Api
```

Swagger is served at `/swagger` in Development. Health check at `/health`.

### Required configuration

Put these in `appsettings.Development.json` (git-ignored) or user secrets — never in
`appsettings.json`:

```jsonc
{
  "ConnectionStrings": {
    "Default": "Server=(localdb)\\MSSQLLocalDB;Database=ConfiguratorDb;Trusted_Connection=True;TrustServerCertificate=True"
  },
  "Jwt": {
    // 32+ bytes. Production: Key Vault.
    "SigningKey": "<a long random string>"
  },
  "Storage": {
    "ConnectionString": "<Azure Storage connection string>",
    "Container": "configurator"
  },
  "Queue": {
    "ConnectionString": "<Azure Storage connection string>",
    "QueueName": "render-jobs"
  },
  "Seed": {
    "AdminEmail": "admin@yourdomain.com",
    "AdminPassword": "<at least 10 characters>"
  }
}
```

With no `Storage:ConnectionString` the API still builds and runs, but any endpoint
that issues a SAS URL will fail — Blob Storage is not optional. With no
`Queue:ConnectionString`, render jobs are logged and dropped so the rest of the API
can be exercised before the worker exists.

### Local storage: Azurite

Local development runs against Azurite, the storage emulator, so the code path is
identical to Azure — the same SAS signing, the same block-blob uploads, the same
CORS rules. Moving to a real account later is a connection-string change and
nothing else.

Visual Studio 2022 ships Azurite, so there is nothing to install:

```
"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\Extensions\Microsoft\Azure Storage Emulator\azurite.exe" --silent --location backend\.azurite --blobHost 127.0.0.1 --blobPort 10000 --queueHost 127.0.0.1 --queuePort 10001
```

Then apply the CORS rules **once per Azurite data directory**:

```
node backend/tools/azurite-setup.mjs
```

That step is not optional. The browser PUTs .glb files and capture images straight
to storage using a SAS URL, which makes storage the cross-origin target; without
CORS rules the preflight is rejected and every upload fails. A real storage account
needs the same rules set once under Settings → Resource sharing (CORS).

Use the full connection string, not `UseDevelopmentStorage=true`:

```jsonc
"Storage": {
  "ConnectionString": "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;",
  "Container": "configurator"
}
```

The shorthand is tempting but breaks silently: `AzureBlobStorage.TryParseSharedKey`
looks for `AccountName` and `AccountKey` in the string, and finding neither it falls
back to returning unsigned URLs. Uploads then fail with 403 and nothing explains why.

Those credentials are Azurite's published defaults — a well-known emulator account,
not a secret.

---

## Roles

| Role | Can do |
| --- | --- |
| `Admin` | Everything, including creating users |
| `Artist` | Upload models, capture angles, publish |
| `Analyst` | Attach the schedule, publish, configure |
| `Customer` | Use the 2D configurator and save selections |

Policies are named by capability rather than by role: `CanManageModels`,
`CanPublish`, `CanConfigure`.

Self-service registration is deliberately absent — `POST /api/auth/register` is
Admin-only, because this is an internal tool.

---

## The flow this API implements

The ordering matters and was a deliberate decision (**Flow B**): the artist captures
angles before the workbook exists, so layer generation cannot happen at capture time.

1. `POST /api/models` → reserves a row, returns a SAS URL. The browser PUTs the `.glb`
   **straight to Blob**; it never passes through the API.
2. `POST /api/models/{id}/complete` → the browser reports node/mesh/material counts it
   parsed, and the API verifies the blob actually landed.
3. `POST /api/models/{id}/captures` → per angle: reserves the capture, stores the
   camera pose and the visible-node list, returns SAS URLs for the base image and
   thumbnail.
4. `POST /api/models/{id}/captures/publish` → the "Save All" action. Publishes the
   chosen angles and queues layer generation **if a schedule is already attached**.
5. `POST /api/models/{id}/schedule` → the analyst attaches the workbook. This also
   queues layer generation for any angle published earlier — the step that resolves
   the ordering problem.
6. The render worker calls `GET /api/captures/{id}/render-spec`, renders one layer per
   part per option, registers each with `POST /api/captures/{id}/layers`, uploads to
   Blob, then reports completion.
7. `GET /api/models/{id}/views` → everything module 2 needs: published angles, their
   base images, and every layer URL.

### Why layers

GMC-style behaviour means the picture changes when an option is chosen. Pre-rendering
every *combination* is impossible — 42 parts × ~4.5 options is astronomincal. Layers
are **additive rather than multiplicative**: one transparent image per part per option
per angle, composited in the browser.

Each layer is rendered from the *full* scene and masked to that part's pixels, so
shadows and occlusion are correct. Because each pixel belongs to exactly one
front-most part, layers never overlap and can be composited in any order.

---

## Storage layout

```
models/{modelId}/{filename}.glb
schedules/{scheduleId}/{filename}.xlsx
captures/{captureId}/base.webp
captures/{captureId}/thumb.webp
captures/{captureId}/layers/{node}__{option}.webp
```

Paths are generated by `BlobPaths` so the API and the render worker cannot disagree.

The container is private; every URL handed to a client is a short-lived SAS. For
production, swap the account-key SAS for a **user delegation SAS** backed by a managed
identity — same call shape, no secret in configuration.

---

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Image format | **WebP** with alpha | ~⅓ the size of PNG; at ~2,000 layers per model that is the difference between 500 MB and 155 MB |
| Default resolution | **1920×1080**, per-capture override | Detail shots can go higher without inflating every angle |
| Glass | Baked into the base image | A transparent surface owns the pixels in front of whatever is behind it, so a configurable part behind glass could not repaint correctly |
| Re-uploading a `.glb` | Creates a **new version** | Captures and schedules key off node names; a re-export can rename nodes and silently invalidate both |
| Deleting a published capture | **Archived**, not deleted | Published URLs may be in use; a draft with nothing referencing it is deleted outright |
| Schedule | One current version per model, superseded on replace | Traceable, and layers can be tied to a version |
| Flattened output | Not yet — selections are stored | A saved selection can produce a render at any resolution later; a flattened PNG cannot be re-rendered |

---

## Known gaps

- **Migrations run at startup.** Convenient for one instance; with several app
  instances this races. Move to a deployment step before scaling out.
- **No refresh-token endpoint yet.** `TokenService` can mint them; the flow is not wired.
- **.NET 8 support ends 10 November 2026.** The 8 → 10 upgrade is a target-framework
  bump; schedule it before go-live.
- **The render worker is not in this repository.** It consumes `render-jobs` and is
  expected to drive headless Chrome running the same three.js code as the frontend, so
  its output is pixel-identical to what the artist saw.
