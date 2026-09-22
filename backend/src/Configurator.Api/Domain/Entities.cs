using Microsoft.AspNetCore.Identity;

namespace Configurator.Api.Domain;

/// <summary>
/// Named roles. Mirrors the two-user workflow in the requirement: a 3D artist
/// captures angles, a business analyst attaches the schedule and curates which
/// images go live, and a customer only ever configures.
/// </summary>
public static class Roles
{
    public const string Admin = "Admin";
    public const string Artist = "Artist";
    public const string Analyst = "Analyst";
    public const string Customer = "Customer";

    public static readonly string[] All = { Admin, Artist, Analyst, Customer };

    // Policy names used on controllers.
    public const string CanManageModels = nameof(CanManageModels);   // upload .glb, capture
    public const string CanPublish = nameof(CanPublish);             // attach schedule, publish captures
    public const string CanConfigure = nameof(CanConfigure);         // use the 2D configurator
}

public class AppUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool IsActive { get; set; } = true;
}

public class AppRole : IdentityRole<Guid>
{
    public AppRole() { }
    public AppRole(string name) : base(name) { }
}

/// <summary>A home/project grouping one or more models.</summary>
public class Project
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid CreatedByUserId { get; set; }

    public List<ModelAsset> Models { get; set; } = new();
}

public enum ModelStatus
{
    /// <summary>Uploaded; the artist is still choosing angles.</summary>
    Draft = 0,
    /// <summary>Schedule attached and layer generation queued or running.</summary>
    Processing = 1,
    /// <summary>At least one published capture; visible in the configurator.</summary>
    Ready = 2,
    /// <summary>Superseded by a newer version of the same .glb.</summary>
    Archived = 3,
}

/// <summary>
/// One uploaded .glb. Re-uploading a changed model creates a NEW row rather than
/// overwriting: captures and schedules are keyed to node names, and a re-export can
/// rename or restructure nodes, which would silently invalidate both.
/// </summary>
public class ModelAsset
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }

    public string Name { get; set; } = string.Empty;        // "modern_kitchen.glb"
    public string BlobPath { get; set; } = string.Empty;    // models/{id}/model.glb
    public long SizeBytes { get; set; }
    public string? ContentHash { get; set; }                // detects a re-upload of identical bytes

    public int Version { get; set; } = 1;
    public Guid? SupersedesModelId { get; set; }

    public ModelStatus Status { get; set; } = ModelStatus.Draft;

    /// <summary>Counts read from the .glb by the frontend after parsing, for display only.</summary>
    public int NodeCount { get; set; }
    public int MeshCount { get; set; }
    public int MaterialCount { get; set; }
    public int TextureCount { get; set; }

    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid UploadedByUserId { get; set; }

    public List<Capture> Captures { get; set; } = new();
    public Schedule? Schedule { get; set; }
}

public enum CaptureStatus
{
    /// <summary>Taken by the artist, not yet committed.</summary>
    Draft = 0,
    /// <summary>Committed; eligible for layer generation and the configurator.</summary>
    Published = 1,
    /// <summary>Removed from the configurator but kept — published URLs may exist.</summary>
    Archived = 2,
}

/// <summary>
/// How much of a capture is configurable. Thirty angles per model is a lot of layer
/// rendering; detail shots usually only need the one part they are showing.
/// </summary>
public enum CaptureTier
{
    /// <summary>Every visible scheduled node gets layers.</summary>
    Full = 0,
    /// <summary>Only the nodes listed in ConfigurableNodeNames get layers.</summary>
    Detail = 1,
    /// <summary>Base image only — a hero shot, nothing configurable.</summary>
    Static = 2,
}

public enum LayerGenerationStatus
{
    NotRequested = 0,
    Queued = 1,
    Running = 2,
    Complete = 3,
    Failed = 4,
}

/// <summary>
/// One camera angle. Holds the base image, the camera pose needed to reproduce the
/// shot exactly during layer generation, and the nodes visible in frame.
/// </summary>
public class Capture
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ModelId { get; set; }
    public ModelAsset? Model { get; set; }

    public string Name { get; set; } = string.Empty;
    public int SortOrder { get; set; }

    public CaptureStatus Status { get; set; } = CaptureStatus.Draft;
    public CaptureTier Tier { get; set; } = CaptureTier.Full;

    // --- Imagery -----------------------------------------------------------------
    public string BaseImagePath { get; set; } = string.Empty;   // captures/{id}/base.webp
    public string? ThumbnailPath { get; set; }
    public int Width { get; set; } = 1920;
    public int Height { get; set; } = 1080;

    // --- Camera pose, so a render worker can reproduce the angle exactly ---------
    public double CameraX { get; set; }
    public double CameraY { get; set; }
    public double CameraZ { get; set; }
    public double TargetX { get; set; }
    public double TargetY { get; set; }
    public double TargetZ { get; set; }
    public double FieldOfView { get; set; } = 45;

    /// <summary>
    /// Node names visible in this frame, JSON array. Derived from an object-ID pass at
    /// capture time, so occluded parts are correctly excluded. This is the metadata the
    /// configurator reads to decide which nodes to offer.
    /// </summary>
    public string VisibleNodesJson { get; set; } = "[]";

    /// <summary>Subset of VisibleNodes to generate layers for when Tier = Detail.</summary>
    public string ConfigurableNodesJson { get; set; } = "[]";

    public LayerGenerationStatus LayerStatus { get; set; } = LayerGenerationStatus.NotRequested;
    public string? LayerError { get; set; }
    public DateTimeOffset? LayersGeneratedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid CreatedByUserId { get; set; }

    public List<CaptureLayer> Layers { get; set; } = new();
}

/// <summary>
/// One part shown with one option, as a transparent image aligned to the base.
/// Rendered from the full scene and masked to that part's pixels, so shadows and
/// occlusion are correct. Layers never overlap, so the client composites in any order.
/// </summary>
public class CaptureLayer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CaptureId { get; set; }
    public Capture? Capture { get; set; }

    public string NodeName { get; set; } = string.Empty;     // matches the .glb node
    public string OptionKey { get; set; } = string.Empty;    // stable key from the schedule
    public string ImagePath { get; set; } = string.Empty;    // captures/{id}/layers/{node}__{option}.webp
    public long SizeBytes { get; set; }
}

/// <summary>
/// The Configurator Parameters workbook, attached to the model rather than uploaded
/// per session. Versioned: replacing it supersedes the previous row so a change is
/// traceable and layer regeneration can be tied to a specific version.
/// </summary>
public class Schedule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ModelId { get; set; }
    public ModelAsset? Model { get; set; }

    public string FileName { get; set; } = string.Empty;
    public string BlobPath { get; set; } = string.Empty;     // schedules/{id}/{filename}
    public int Version { get; set; } = 1;
    public bool IsCurrent { get; set; } = true;

    /// <summary>
    /// Parsed result: node -> colours/textures, as the normalised JSON the frontend
    /// parser already produces. Stored so the configurator and the render worker read
    /// identical option data without re-parsing the workbook.
    /// </summary>
    public string ParsedJson { get; set; } = "{}";

    public int GroupCount { get; set; }
    public int OptionCount { get; set; }

    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid UploadedByUserId { get; set; }
}

/// <summary>A customer's saved selection: node -> chosen option, across all angles.</summary>
public class SavedConfiguration
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ModelId { get; set; }
    public ModelAsset? Model { get; set; }

    public string Name { get; set; } = string.Empty;
    public Guid OwnerUserId { get; set; }

    /// <summary>JSON: [{ nodeName, optionKey, optionName, colour, texture }]</summary>
    public string SelectionsJson { get; set; } = "[]";

    /// <summary>Set later, when flattened renders are produced and stored.</summary>
    public string? FlattenedImagePath { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
