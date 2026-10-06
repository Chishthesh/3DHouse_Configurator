using System.Text.Json;
using Configurator.Api.Data;
using Configurator.Api.Domain;
using Configurator.Api.Dtos;
using Configurator.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Configurator.Api.Controllers;

/// <summary>
/// The public side of a model's share link. Visitors arrive from other websites with
/// no account here, so this is anonymous — the unguessable token is the only key, and
/// it unlocks exactly one model, read-only: its published angles and finish schedule.
/// </summary>
[ApiController]
[Route("api/share")]
[AllowAnonymous]
public class SharedController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IBlobStorage _blobs;

    public SharedController(AppDbContext db, IBlobStorage blobs)
    {
        _db = db;
        _blobs = blobs;
    }

    [HttpGet("{token}")]
    public async Task<ActionResult<SharedModelDto>> Get(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 32) return NotFound();

        var model = await _db.Models.AsNoTracking()
            .FirstOrDefaultAsync(m => m.ShareToken == token && m.Status != ModelStatus.Archived, ct);
        if (model is null) return NotFound(new { message = "This link is not valid, or the model has been removed." });

        var schedule = await _db.Schedules.AsNoTracking()
            .FirstOrDefaultAsync(s => s.ModelId == model.Id && s.IsCurrent, ct);

        var views = await CapturesController.LoadViewsAsync(_db, _blobs, model.Id, ct);

        return Ok(new SharedModelDto(
            model.Name,
            model.Version,
            views,
            schedule is null ? null : JsonSerializer.Deserialize<JsonElement>(schedule.ParsedJson)));
    }
}
