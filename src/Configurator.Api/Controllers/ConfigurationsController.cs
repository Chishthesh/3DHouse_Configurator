using System.Security.Claims;
using System.Text.Json;
using Configurator.Api.Data;
using Configurator.Api.Domain;
using Configurator.Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Configurator.Api.Controllers;

/// <summary>
/// A customer's selections: node -> chosen option, shared across every angle. Stored
/// as the selection itself rather than a rendered image, so the same configuration can
/// later produce a flattened render at any resolution.
/// </summary>
[ApiController]
[Route("api/configurations")]
[Authorize(Policy = Roles.CanConfigure)]
public class ConfigurationsController : ControllerBase
{
    private readonly AppDbContext _db;
    public ConfigurationsController(AppDbContext db) => _db = db;

    private Guid CurrentUserId =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    private static SelectionDto[] Parse(string json)
    {
        try { return JsonSerializer.Deserialize<SelectionDto[]>(json) ?? Array.Empty<SelectionDto>(); }
        catch { return Array.Empty<SelectionDto>(); }
    }

    [HttpGet]
    public async Task<ActionResult<List<ConfigurationDto>>> List([FromQuery] Guid? modelId, CancellationToken ct)
    {
        var query = _db.SavedConfigurations.AsNoTracking().Where(c => c.OwnerUserId == CurrentUserId);
        if (modelId is not null) query = query.Where(c => c.ModelId == modelId);

        var rows = await query.OrderByDescending(c => c.UpdatedAt).ToListAsync(ct);
        return Ok(rows.Select(c =>
            new ConfigurationDto(c.Id, c.ModelId, c.Name, Parse(c.SelectionsJson), c.UpdatedAt)).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ConfigurationDto>> Get(Guid id, CancellationToken ct)
    {
        var c = await _db.SavedConfigurations.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.OwnerUserId == CurrentUserId, ct);
        if (c is null) return NotFound();
        return Ok(new ConfigurationDto(c.Id, c.ModelId, c.Name, Parse(c.SelectionsJson), c.UpdatedAt));
    }

    [HttpPost]
    public async Task<ActionResult<ConfigurationDto>> Save(SaveConfigurationRequest request, CancellationToken ct)
    {
        if (!await _db.Models.AnyAsync(m => m.Id == request.ModelId, ct))
            return BadRequest(new { message = "Unknown model." });

        // Saving under a name already used by this user updates it rather than
        // accumulating near-identical rows.
        var existing = await _db.SavedConfigurations.FirstOrDefaultAsync(
            c => c.OwnerUserId == CurrentUserId && c.ModelId == request.ModelId && c.Name == request.Name, ct);

        if (existing is null)
        {
            existing = new SavedConfiguration
            {
                ModelId = request.ModelId,
                Name = request.Name,
                OwnerUserId = CurrentUserId,
            };
            _db.SavedConfigurations.Add(existing);
        }

        existing.SelectionsJson = JsonSerializer.Serialize(request.Selections ?? Array.Empty<SelectionDto>());
        existing.UpdatedAt = DateTimeOffset.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(new ConfigurationDto(
            existing.Id, existing.ModelId, existing.Name, Parse(existing.SelectionsJson), existing.UpdatedAt));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var c = await _db.SavedConfigurations
            .FirstOrDefaultAsync(x => x.Id == id && x.OwnerUserId == CurrentUserId, ct);
        if (c is null) return NotFound();

        _db.SavedConfigurations.Remove(c);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}
