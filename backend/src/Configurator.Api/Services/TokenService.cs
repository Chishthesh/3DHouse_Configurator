using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Configurator.Api.Domain;
using Microsoft.IdentityModel.Tokens;

namespace Configurator.Api.Services;

public class JwtOptions
{
    public string Issuer { get; set; } = "Configurator.Api";
    public string Audience { get; set; } = "Configurator.Web";
    /// <summary>Must be at least 32 bytes for HS256. Supplied by configuration/Key Vault.</summary>
    public string SigningKey { get; set; } = string.Empty;
    public int AccessTokenMinutes { get; set; } = 60;
    public int RefreshTokenDays { get; set; } = 14;
}

public interface ITokenService
{
    (string token, DateTimeOffset expiresAt) CreateAccessToken(AppUser user, IEnumerable<string> roles);
    string CreateRefreshToken();
}

public class TokenService : ITokenService
{
    private readonly JwtOptions _options;
    public TokenService(JwtOptions options) => _options = options;

    public (string token, DateTimeOffset expiresAt) CreateAccessToken(AppUser user, IEnumerable<string> roles)
    {
        var expires = DateTimeOffset.UtcNow.AddMinutes(_options.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new("displayName", user.DisplayName),
        };
        // Role claims drive the authorization policies; the client also reads them to
        // decide which of the two modules to show.
        claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: expires.UtcDateTime,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }

    public string CreateRefreshToken()
    {
        var bytes = System.Security.Cryptography.RandomNumberGenerator.GetBytes(64);
        return Convert.ToBase64String(bytes);
    }
}
