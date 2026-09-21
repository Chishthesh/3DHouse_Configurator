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
[Route("api/models/{modelId:guid}/schedule")]
[Authorize]
public class SchedulesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IBlobStorage _blobs;
    private readonly IRenderJobQueue _jobs;

    public SchedulesController(AppDbContext db, IBlobStorage blobs, IRenderJobQueue jobs)
    {
        _db = db;
        _blobs = blobs;
        _jobs = jobs;
    }

    private Guid CurrentUserId =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    /// <summary>
    /// The parsed option data the configurator reads. Served from the stored JSON
    /// rather than re-parsing the workbook, so the browser and the render worker are
    /// guaranteed to see identical options.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Get(Guid modelId, CancellationToken ct)
    {
        var schedule = await _db.Schedules.AsNoTracking()
            .FirstOrDefaultAsync(s => s.ModelId == modelId && s.IsCurrent, ct);

        if (schedule is null) return NotFound(new { message = "No schedule attached to this model." });

        return Content(schedule.ParsedJson, "application/json");
    }

    [HttpGet("meta")]
    public async Task<ActionResult<ScheduleDto>> GetMeta(Guid modelId, CancellationToken ct)
    {
        var s = await _db.Schedules.AsNoTracking()
            .FirstOrDefaultAsync(x => x.ModelId == modelId && x.IsCurrent, ct);
        if (s is null) return NotFound();
        return Ok(new ScheduleDto(s.Id, s.FileName, s.Version, s.GroupCount, s.OptionCount, s.UploadedAt));
    }

    /// <summary>
    /// Attaches the Configurator Parameters workbook to the model — once, not per
    /// session. Replacing it supersedes the previous version rather than overwriting,
    /// so a change of options is traceable and layers can be tied to a version.
    ///
    /// Attaching is also what unblocks layer generation for captures published before
    /// the workbook arrived, which is the ordering this flow was designed around.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = Roles.CanPublish)]
    public async Task<ActionResult<AttachScheduleResponse>> Attach(
        Guid modelId, AttachScheduleRequest request, CancellationToken ct)
    {
        var model = await _db.Models.FirstOrDefaultAsync(m => m.Id == modelId, ct);
        if (model is null) return NotFound();

        if (request.OptionCount <= 0)
            return BadRequest(new { message = "The workbook produced no usable options." });

        var existing = await _db.Schedules
            .Where(s => s.ModelId == modelId)
            .OrderByDescending(s => s.Version)
            .ToListAsync(ct);

        foreach (var old in existing) old.IsCurrent = false;

        var schedule = new Schedule
        {
            ModelId = modelId,
            FileName = request.FileName,
            ParsedJson = request.ParsedJson,
            GroupCount = request.GroupCount,
            OptionCount = request.OptionCount,
            Version = existing.Count == 0 ? 1 : existing.Max(s => s.Version) + 1,
            IsCurrent = true,
            UploadedByUserId = CurrentUserId,
        };
        schedule.BlobPath = BlobPaths.Schedule(schedule.Id, request.FileName);

        // One schedule row per model is enforced by the one-to-one mapping, so a
        // superseded row is removed once its replacement is in place.
        foreach (var old in existing) _db.Schedules.Remove(old);
        _db.Schedules.Add(schedule);
        await _db.SaveChangesAsync(ct);

        // Any already-published angle can now have its layers built.
        var pending = await _db.Captures
            .Where(c => c.ModelId == modelId
                        && c.Status == CaptureStatus.Published
                        && c.Tier != CaptureTier.Static)
            .ToListAsync(ct);

        foreach (var capture in pending)
        {
            capture.LayerStatus = LayerGenerationStatus.Queued;
            capture.LayerError = null;
            await _jobs.EnqueueAsync(new RenderJob(modelId, capture.Id, schedule.Id), ct);
        }
        if (pending.Count > 0) model.Status = ModelStatus.Processing;
        await _db.SaveChangesAsync(ct);

        var ticket = _blobs.CreateUploadTicket(schedule.BlobPath);
        return Ok(new AttachScheduleResponse(schedule.Id, ticket.UploadUrl, ticket.BlobPath, ticket.ExpiresAt));
    }
}
