using System.Security.Claims;
using Configurator.Api.Domain;
using Configurator.Api.Dtos;
using Configurator.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Configurator.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly UserManager<AppUser> _users;
    private readonly SignInManager<AppUser> _signIn;
    private readonly ITokenService _tokens;

    public AuthController(UserManager<AppUser> users, SignInManager<AppUser> signIn, ITokenService tokens)
    {
        _users = users;
        _signIn = signIn;
        _tokens = tokens;
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var user = await _users.FindByEmailAsync(request.Email);
        // Same response whether the account is missing, disabled or the password is
        // wrong — otherwise the endpoint enumerates valid accounts.
        if (user is null || !user.IsActive)
            return Unauthorized(new { message = "Invalid email or password." });

        var result = await _signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true);
        if (result.IsLockedOut)
            return Unauthorized(new { message = "Account temporarily locked. Try again later." });
        if (!result.Succeeded)
            return Unauthorized(new { message = "Invalid email or password." });

        var roles = await _users.GetRolesAsync(user);
        var (token, expiresAt) = _tokens.CreateAccessToken(user, roles);

        return Ok(new AuthResponse(token, expiresAt,
            new UserDto(user.Id, user.Email!, user.DisplayName, roles.ToArray())));
    }

    /// <summary>Admin-only. Self-service signup is not part of an internal tool.</summary>
    [HttpPost("register")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Register(RegisterRequest request)
    {
        if (await _users.FindByEmailAsync(request.Email) is not null)
            return Conflict(new { message = "A user with that email already exists." });

        var user = new AppUser
        {
            UserName = request.Email,
            Email = request.Email,
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? request.Email : request.DisplayName,
        };

        var created = await _users.CreateAsync(user, request.Password);
        if (!created.Succeeded)
            return BadRequest(new { errors = created.Errors.Select(e => e.Description) });

        var role = Roles.All.Contains(request.Role) ? request.Role! : Roles.Customer;
        await _users.AddToRoleAsync(user, role);

        return Ok(new UserDto(user.Id, user.Email!, user.DisplayName, new[] { role }));
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null) return Unauthorized();

        var user = await _users.FindByIdAsync(id);
        if (user is null) return Unauthorized();

        var roles = await _users.GetRolesAsync(user);
        return Ok(new UserDto(user.Id, user.Email!, user.DisplayName, roles.ToArray()));
    }
}
