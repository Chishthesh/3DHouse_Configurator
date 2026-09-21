using System.Security.Claims;
using Configurator.Api.Data;
using Configurator.Api.Domain;
using Configurator.Api.Dtos;
using Configurator.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Configurator.Api.Controllers;

[ApiController]
[Route("api/models")]
[Authorize]
public class ModelsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IBlobStorage _blobs;

    public ModelsController(AppDbContext db, IBlobStorage blobs)
    {
        _db = db;
        _blobs = blobs;
    }

    private Guid CurrentUserId =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    /// <summary>
    /// Module 1's landing list. Also used by module 2 with readyOnly=true, which
    /// restricts it to models that actually have something to configure.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<ModelListItemDto>>> List(
        [FromQuery] Guid? projectId, [FromQuery] bool readyOnly = false, CancellationToken ct = default)
    {
        var query = _db.Models.AsNoTracking().Where(m => m.Status != ModelStatus.Archived);

        if (projectId is not null) query = query.Where(m => m.ProjectId == projectId);

        if (readyOnly)
        {
            // A model is usable by the configurator only once it has a schedule and at
            // least one published capture; without both, the right-hand panel is empty.
            query = query.Where(m =>
                m.Schedule != null &&
                m.Captures.Any(c => c.Status == CaptureStatus.Published));
        }

        var items = await query
            .OrderByDescending(m => m.UploadedAt)
            .Select(m => new ModelListItemDto(
                m.Id,
                m.ProjectId,
                m.Name,
                m.SizeBytes,
                m.Version,
                m.Status,
                m.Captures.Count,
                m.Captures.Count(c => c.Status == CaptureStatus.Published),
                m.Schedule != null,
                m.UploadedAt))
            .ToListAsync(ct);

        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ModelDetailDto>> Get(Guid id, CancellationToken ct)
    {
        var model = await _db.Models.AsNoTracking()
            .Include(m => m.Schedule)
            .FirstOrDefaultAsync(m => m.Id == id, ct);

        if (model is null) return NotFound();

        var schedule = model.Schedule is null
            ? null
            : new ScheduleDto(model.Schedule.Id, model.Schedule.FileName, model.Schedule.Version,
                model.Schedule.GroupCount, model.Schedule.OptionCount, model.Schedule.UploadedAt);

        return Ok(new ModelDetailDto(
            model.Id, model.ProjectId, model.Name, model.SizeBytes, model.Version, model.Status,
            _blobs.CreateReadUrl(model.BlobPath),
            model.NodeCount, model.MeshCount, model.MaterialCount, model.TextureCount,
            schedule, model.UploadedAt));
    }

    /// <summary>
    /// Step 1 of the upload. Reserves the row and returns a SAS URL; the browser then
    /// PUTs the .glb straight to Blob Storage. A 5–50 MB model has no reason to travel
    /// through the API.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = Roles.CanManageModels)]
    public async Task<ActionResult<CreateModelResponse>> Create(CreateModelRequest request, CancellationToken ct)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == request.ProjectId, ct))
            return BadRequest(new { message = "Unknown project." });

        if (!request.FileName.EndsWith(".glb", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Only .glb files are accepted. Export as binary glTF." });

        var model = new ModelAsset
        {
            ProjectId = request.ProjectId,
            Name = request.FileName,
            SizeBytes = request.SizeBytes,
            UploadedByUserId = CurrentUserId,
            Status = ModelStatus.Draft,
        };
        model.BlobPath = BlobPaths.Model(model.Id, request.FileName);

        // Re-uploading a changed .glb creates a new version rather than replacing the
        // old one: captures and schedules are keyed to node names, and a re-export can
        // rename nodes, which would silently invalidate both.
        var previous = await _db.Models
            .Where(m => m.ProjectId == request.ProjectId && m.Name == request.FileName
                        && m.Status != ModelStatus.Archived)
            .OrderByDescending(m => m.Version)
            .FirstOrDefaultAsync(ct);

        if (previous is not null)
        {
            model.Version = previous.Version + 1;
            model.SupersedesModelId = previous.Id;
        }

        _db.Models.Add(model);
        await _db.SaveChangesAsync(ct);

        var ticket = _blobs.CreateUploadTicket(model.BlobPath);
        return Ok(new CreateModelResponse(model.Id, ticket.UploadUrl, ticket.BlobPath, ticket.ExpiresAt));
    }

    /// <summary>Step 2: the browser confirms the upload and reports what it parsed.</summary>
    [HttpPost("{id:guid}/complete")]
    [Authorize(Policy = Roles.CanManageModels)]
    public async Task<IActionResult> CompleteUpload(Guid id, CompleteModelUploadRequest request, CancellationToken ct)
    {
        var model = await _db.Models.FirstOrDefaultAsync(m => m.Id == id, ct);
        if (model is null) return NotFound();

        // Trust but verify: without this a failed PUT would leave a row pointing at
        // nothing, and the failure would only surface much later in the configurator.
        if (!await _blobs.ExistsAsync(model.BlobPath, ct))
            return BadRequest(new { message = "The file was not found in storage. Upload did not complete." });

        model.NodeCount = request.NodeCount;
        model.MeshCount = request.MeshCount;
        model.MaterialCount = request.MaterialCount;
        model.TextureCount = request.TextureCount;
        model.ContentHash = request.ContentHash;

        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Roles.CanManageModels)]
    public async Task<IActionResult> Archive(Guid id, CancellationToken ct)
    {
        var model = await _db.Models.FirstOrDefaultAsync(m => m.Id == id, ct);
        if (model is null) return NotFound();

        // Archive rather than delete: published captures may already be linked from
        // elsewhere, and a hard delete would break a configurator session in progress.
        model.Status = ModelStatus.Archived;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}
