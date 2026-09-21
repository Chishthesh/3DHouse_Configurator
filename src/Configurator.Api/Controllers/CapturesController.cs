using System.Security.Claims;
using System.Text.Json;
using Configurator.Api.Data;
using Configurator.Api.Domain;
using Configurator.Api.Dtos;
using Configurator.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Configurator.Api.Controllers;

[ApiController]
[Route("api/models/{modelId:guid}/captures")]
[Authorize]
public class CapturesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IBlobStorage _blobs;
    private readonly IRenderJobQueue _jobs;

    public CapturesController(AppDbContext db, IBlobStorage blobs, IRenderJobQueue jobs)
    {
        _db = db;
        _blobs = blobs;
        _jobs = jobs;
    }

    private Guid CurrentUserId =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    private static string[] ParseNames(string json)
    {
        try { return JsonSerializer.Deserialize<string[]>(json) ?? Array.Empty<string>(); }
        catch { return Array.Empty<string>(); }
    }

    /// <summary>
    /// The Saved Captures tab. Returns drafts too, because that tab is where the artist
    /// decides what to keep; the configurator calls /views instead.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<CaptureListItemDto>>> List(
        Guid modelId, [FromQuery] CaptureStatus? status, CancellationToken ct)
    {
        var query = _db.Captures.AsNoTracking().Where(c => c.ModelId == modelId);
        if (status is not null) query = query.Where(c => c.Status == status);

        var rows = await query
            .OrderBy(c => c.SortOrder).ThenBy(c => c.CreatedAt)
            .Select(c => new
            {
                c.Id, c.Name, c.SortOrder, c.Status, c.Tier, c.LayerStatus,
                LayerCount = c.Layers.Count,
                c.ThumbnailPath, c.BaseImagePath, c.VisibleNodesJson, c.CreatedAt
            })
            .ToListAsync(ct);

        return Ok(rows.Select(r => new CaptureListItemDto(
            r.Id, r.Name, r.SortOrder, r.Status, r.Tier, r.LayerStatus, r.LayerCount,
            _blobs.CreateReadUrl(r.ThumbnailPath ?? r.BaseImagePath),
            ParseNames(r.VisibleNodesJson),
            r.CreatedAt)).ToList());
    }

    /// <summary>
    /// What module 2 renders: published angles with their base image and every layer,
    /// in one call. The client composites base + one selected layer per node.
    /// </summary>
    [HttpGet("/api/models/{modelId:guid}/views")]
    public async Task<ActionResult<List<CaptureViewDto>>> Views(Guid modelId, CancellationToken ct)
    {
        var captures = await _db.Captures.AsNoTracking()
            .Where(c => c.ModelId == modelId && c.Status == CaptureStatus.Published)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.CreatedAt)
            .Include(c => c.Layers)
            .ToListAsync(ct);

        return Ok(captures.Select(c => new CaptureViewDto(
            c.Id, c.Name, c.SortOrder, c.Width, c.Height,
            _blobs.CreateReadUrl(c.BaseImagePath),
            ParseNames(c.VisibleNodesJson),
            ParseNames(c.ConfigurableNodesJson),
            c.Layers
                .Select(l => new LayerDto(l.NodeName, l.OptionKey, _blobs.CreateReadUrl(l.ImagePath)))
                .ToArray()
        )).ToList());
    }

    /// <summary>
    /// Reserves a capture and returns SAS URLs for the base image and thumbnail. The
    /// visible-node list comes from an object-ID pass in the browser, so occluded parts
    /// are correctly excluded — a bounding-box test would wrongly include things hidden
    /// behind walls.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = Roles.CanManageModels)]
    public async Task<ActionResult<CreateCaptureResponse>> Create(
        Guid modelId, CreateCaptureRequest request, CancellationToken ct)
    {
        if (!await _db.Models.AnyAsync(m => m.Id == modelId, ct)) return NotFound();

        var capture = new Capture
        {
            ModelId = modelId,
            Name = string.IsNullOrWhiteSpace(request.Name) ? $"View {request.SortOrder + 1}" : request.Name,
            SortOrder = request.SortOrder,
            Width = request.Width,
            Height = request.Height,
            Tier = request.Tier,
            CameraX = request.Pose.CameraX,
            CameraY = request.Pose.CameraY,
            CameraZ = request.Pose.CameraZ,
            TargetX = request.Pose.TargetX,
            TargetY = request.Pose.TargetY,
            TargetZ = request.Pose.TargetZ,
            FieldOfView = request.Pose.FieldOfView,
            VisibleNodesJson = JsonSerializer.Serialize(request.VisibleNodes ?? Array.Empty<string>()),
            ConfigurableNodesJson = JsonSerializer.Serialize(request.ConfigurableNodes ?? Array.Empty<string>()),
            CreatedByUserId = CurrentUserId,
            Status = CaptureStatus.Draft,
        };
        capture.BaseImagePath = BlobPaths.CaptureBase(capture.Id);
        capture.ThumbnailPath = BlobPaths.CaptureThumb(capture.Id);

        _db.Captures.Add(capture);
        await _db.SaveChangesAsync(ct);

        var baseTicket = _blobs.CreateUploadTicket(capture.BaseImagePath);
        var thumbTicket = _blobs.CreateUploadTicket(capture.ThumbnailPath);

        return Ok(new CreateCaptureResponse(
            capture.Id, baseTicket.UploadUrl, thumbTicket.UploadUrl, baseTicket.ExpiresAt));
    }

    [HttpPatch("{captureId:guid}")]
    [Authorize(Policy = Roles.CanManageModels)]
    public async Task<IActionResult> Update(
        Guid modelId, Guid captureId, UpdateCaptureRequest request, CancellationToken ct)
    {
        var capture = await _db.Captures.FirstOrDefaultAsync(c => c.Id == captureId && c.ModelId == modelId, ct);
        if (capture is null) return NotFound();

        if (request.Name is not null) capture.Name = request.Name;
        if (request.SortOrder is not null) capture.SortOrder = request.SortOrder.Value;
        if (request.Tier is not null) capture.Tier = request.Tier.Value;
        if (request.ConfigurableNodes is not null)
            capture.ConfigurableNodesJson = JsonSerializer.Serialize(request.ConfigurableNodes);

        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>
    /// Discarding an angle during the capture session. A draft is deleted outright —
    /// nothing references it yet — but a published capture is archived, because the
    /// configurator may be showing it right now.
    /// </summary>
    [HttpDelete("{captureId:guid}")]
    [Authorize(Policy = Roles.CanManageModels)]
    public async Task<IActionResult> Remove(Guid modelId, Guid captureId, CancellationToken ct)
    {
        var capture = await _db.Captures.FirstOrDefaultAsync(c => c.Id == captureId && c.ModelId == modelId, ct);
        if (capture is null) return NotFound();

        if (capture.Status == CaptureStatus.Draft)
        {
            await _blobs.DeletePrefixAsync(BlobPaths.CapturePrefix(capture.Id), ct);
            _db.Captures.Remove(capture);
        }
        else
        {
            capture.Status = CaptureStatus.Archived;
        }

        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>
    /// "Save" / "Save All" at the end of a capture session. Publishing is also what
    /// queues layer generation, which is the expensive part — so it happens once the
    /// artist has committed to a set of angles, not on every capture.
    /// </summary>
    [HttpPost("publish")]
    [Authorize(Policy = Roles.CanPublish)]
    public async Task<ActionResult<PublishCapturesResponse>> Publish(
        Guid modelId, PublishCapturesRequest request, CancellationToken ct)
    {
        var model = await _db.Models.Include(m => m.Schedule)
            .FirstOrDefaultAsync(m => m.Id == modelId, ct);
        if (model is null) return NotFound();

        var captures = await _db.Captures
            .Where(c => c.ModelId == modelId && request.CaptureIds.Contains(c.Id))
            .ToListAsync(ct);

        foreach (var capture in captures) capture.Status = CaptureStatus.Published;

        var queued = 0;
        if (request.GenerateLayers)
        {
            // Flow B: layers need the schedule, because the options define what to
            // render. Publishing without one is allowed — the job is queued later, when
            // the analyst attaches the workbook.
            if (model.Schedule is null)
            {
                await _db.SaveChangesAsync(ct);
                return Ok(new PublishCapturesResponse(captures.Count, 0));
            }

            foreach (var capture in captures.Where(c => c.Tier != CaptureTier.Static))
            {
                capture.LayerStatus = LayerGenerationStatus.Queued;
                capture.LayerError = null;
                await _jobs.EnqueueAsync(new RenderJob(modelId, capture.Id, model.Schedule.Id), ct);
                queued++;
            }

            if (queued > 0) model.Status = ModelStatus.Processing;
        }

        if (captures.Count > 0 && model.Status != ModelStatus.Processing)
            model.Status = ModelStatus.Ready;

        await _db.SaveChangesAsync(ct);
        return Ok(new PublishCapturesResponse(captures.Count, queued));
    }
}
