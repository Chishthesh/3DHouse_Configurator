using Configurator.Api.Data;
using Configurator.Api.Domain;
using Configurator.Api.Dtos;
using Configurator.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Configurator.Api.Controllers;

/// <summary>
/// Written by the render worker, not the browser. The worker asks for an upload URL
/// per layer, PUTs the image to Blob, then reports the angle complete.
/// </summary>
[ApiController]
[Route("api/captures/{captureId:guid}/layers")]
[Authorize(Policy = Roles.CanManageModels)]
public class LayersController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IBlobStorage _blobs;

    public LayersController(AppDbContext db, IBlobStorage blobs)
    {
        _db = db;
        _blobs = blobs;
    }

    /// <summary>
    /// Everything the worker needs to reproduce the angle: the model, the camera pose
    /// and the parsed options. Returned in one call so a worker restart is cheap.
    /// </summary>
    [HttpGet("/api/captures/{captureId:guid}/render-spec")]
    public async Task<IActionResult> RenderSpec(Guid captureId, CancellationToken ct)
    {
        var capture = await _db.Captures.AsNoTracking()
            .Include(c => c.Model).ThenInclude(m => m!.Schedule)
            .FirstOrDefaultAsync(c => c.Id == captureId, ct);

        if (capture?.Model is null) return NotFound();
        if (capture.Model.Schedule is null)
            return BadRequest(new { message = "No schedule attached; nothing to render." });

        return Ok(new
        {
            captureId = capture.Id,
            modelId = capture.ModelId,
            modelUrl = _blobs.CreateReadUrl(capture.Model.BlobPath, TimeSpan.FromHours(4)),
            width = capture.Width,
            height = capture.Height,
            tier = capture.Tier.ToString(),
            pose = new
            {
                camera = new[] { capture.CameraX, capture.CameraY, capture.CameraZ },
                target = new[] { capture.TargetX, capture.TargetY, capture.TargetZ },
                fov = capture.FieldOfView,
            },
            visibleNodesJson = capture.VisibleNodesJson,
            configurableNodesJson = capture.ConfigurableNodesJson,
            scheduleJson = capture.Model.Schedule.ParsedJson,
        });
    }

    [HttpPost]
    public async Task<ActionResult<RegisterLayerResponse>> Register(
        Guid captureId, RegisterLayerRequest request, CancellationToken ct)
    {
        var capture = await _db.Captures.FirstOrDefaultAsync(c => c.Id == captureId, ct);
        if (capture is null) return NotFound();

        // A retried job must not duplicate rows, so an existing layer is reused and
        // simply overwritten in storage.
        var layer = await _db.CaptureLayers.FirstOrDefaultAsync(
            l => l.CaptureId == captureId && l.NodeName == request.NodeName && l.OptionKey == request.OptionKey, ct);

        if (layer is null)
        {
            layer = new CaptureLayer
            {
                CaptureId = captureId,
                NodeName = request.NodeName,
                OptionKey = request.OptionKey,
                ImagePath = BlobPaths.CaptureLayer(captureId, request.NodeName, request.OptionKey),
                SizeBytes = request.SizeBytes,
            };
            _db.CaptureLayers.Add(layer);
        }
        else
        {
            layer.SizeBytes = request.SizeBytes;
        }

        if (capture.LayerStatus is LayerGenerationStatus.Queued or LayerGenerationStatus.NotRequested)
            capture.LayerStatus = LayerGenerationStatus.Running;

        await _db.SaveChangesAsync(ct);

        var ticket = _blobs.CreateUploadTicket(layer.ImagePath, TimeSpan.FromHours(2));
        return Ok(new RegisterLayerResponse(layer.Id, ticket.UploadUrl, ticket.BlobPath, ticket.ExpiresAt));
    }

    [HttpPost("/api/captures/{captureId:guid}/layer-status")]
    public async Task<IActionResult> ReportStatus(
        Guid captureId, ReportLayerStatusRequest request, CancellationToken ct)
    {
        var capture = await _db.Captures
            .Include(c => c.Model)
            .FirstOrDefaultAsync(c => c.Id == captureId, ct);
        if (capture is null) return NotFound();

        capture.LayerStatus = request.Status;
        capture.LayerError = request.Error;
        if (request.Status == LayerGenerationStatus.Complete)
            capture.LayersGeneratedAt = DateTimeOffset.UtcNow;

        await _db.SaveChangesAsync(ct);

        // The model leaves Processing only when no angle is still outstanding.
        if (capture.Model is not null)
        {
            var outstanding = await _db.Captures.AnyAsync(c =>
                c.ModelId == capture.ModelId &&
                c.Status == CaptureStatus.Published &&
                (c.LayerStatus == LayerGenerationStatus.Queued || c.LayerStatus == LayerGenerationStatus.Running), ct);

            if (!outstanding)
            {
                capture.Model.Status = ModelStatus.Ready;
                await _db.SaveChangesAsync(ct);
            }
        }

        return NoContent();
    }
}
