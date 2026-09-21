using System.Security.Claims;
using Configurator.Api.Data;
using Configurator.Api.Domain;
using Configurator.Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Configurator.Api.Controllers;

[ApiController]
[Route("api/projects")]
[Authorize]
public class ProjectsController : ControllerBase
{
    private readonly AppDbContext _db;
    public ProjectsController(AppDbContext db) => _db = db;

    private Guid CurrentUserId =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    [HttpGet]
    public async Task<ActionResult<List<ProjectDto>>> List(CancellationToken ct)
    {
        var rows = await _db.Projects.AsNoTracking()
            .OrderBy(p => p.Name)
            .Select(p => new ProjectDto(
                p.Id, p.Name, p.Description,
                p.Models.Count(m => m.Status != ModelStatus.Archived),
                p.CreatedAt))
            .ToListAsync(ct);
        return Ok(rows);
    }

    [HttpPost]
    [Authorize(Policy = Roles.CanManageModels)]
    public async Task<ActionResult<ProjectDto>> Create(CreateProjectRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { message = "A project name is required." });

        var project = new Project
        {
            Name = request.Name.Trim(),
            Description = request.Description,
            CreatedByUserId = CurrentUserId,
        };

        _db.Projects.Add(project);
        await _db.SaveChangesAsync(ct);

        return Ok(new ProjectDto(project.Id, project.Name, project.Description, 0, project.CreatedAt));
    }
}
