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

    // --- Textures -----------------------------------------------------------------------
    //
    // The workbook only names textures ("mosaico.jpg"); the image files themselves are
    // uploaded afterwards, one per name, and stored against the model. The configurator
    // reads them back through the stable GET below, so a URL saved in the schedule never
    // expires the way a SAS link would.

    private const long MaxTextureBytes = 20 * 1024 * 1024;

    private static readonly Dictionary<string, string> TextureTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".png"] = "image/png",
        [".webp"] = "image/webp",
        [".avif"] = "image/avif",
        [".gif"] = "image/gif",
    };

    /// <summary>The texture files already uploaded for this model.</summary>
    [HttpGet("textures")]
    public async Task<ActionResult<IEnumerable<TextureDto>>> ListTextures(Guid modelId, CancellationToken ct)
    {
        var prefix = BlobPaths.ScheduleTexturePrefix(modelId);
        var paths = await _blobs.ListAsync(prefix, ct);
        return Ok(paths.Select(p => new TextureDto(p[prefix.Length..])));
    }

    [HttpPut("textures/{fileName}")]
    [Authorize(Policy = Roles.CanPublish)]
    [RequestSizeLimit(MaxTextureBytes)]
    public async Task<ActionResult<TextureDto>> UploadTexture(Guid modelId, string fileName, CancellationToken ct)
    {
        if (!await _db.Models.AnyAsync(m => m.Id == modelId, ct)) return NotFound();

        fileName = Path.GetFileName(fileName);
        if (!TextureTypes.TryGetValue(Path.GetExtension(fileName), out var contentType))
            return BadRequest(new { message = $"\"{fileName}\" is not an image type that can be used as a texture (jpg, png, webp, avif or gif)." });

        await using var buffer = new MemoryStream();
        await Request.Body.CopyToAsync(buffer, ct);
        if (buffer.Length == 0) return BadRequest(new { message = "The texture file was empty." });
        buffer.Position = 0;

        var path = BlobPaths.ScheduleTexture(modelId, fileName);
        await _blobs.UploadAsync(path, buffer, contentType, ct);
        return Ok(new TextureDto(path[BlobPaths.ScheduleTexturePrefix(modelId).Length..]));
    }

    /// <summary>
    /// Anonymous on purpose: the texture is fetched by an &lt;img&gt; or the WebGL loader,
    /// neither of which can send a bearer token, and the shared configurator link has no
    /// sign-in at all. A texture is a swatch, not sensitive data.
    /// </summary>
    [HttpGet("textures/{fileName}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetTexture(Guid modelId, string fileName, CancellationToken ct)
    {
        fileName = Path.GetFileName(fileName);
        if (!TextureTypes.TryGetValue(Path.GetExtension(fileName), out var contentType)) return NotFound();

        var path = BlobPaths.ScheduleTexture(modelId, fileName);
        if (!await _blobs.ExistsAsync(path, ct)) return NotFound();

        Response.Headers.CacheControl = "public, max-age=300";
        return File(await _blobs.OpenReadAsync(path, ct), contentType);
    }
}
