using Configurator.Api.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Configurator.Api.Data;

public static class DbSeeder
{
    /// <summary>
    /// Applies migrations, creates the four roles, and creates a first administrator
    /// from configuration. Seeding a known-password admin is deliberately opt-in via
    /// Seed:AdminEmail / Seed:AdminPassword so a deployment cannot accidentally ship
    /// with a default account.
    /// </summary>
    public static async Task SeedAsync(IServiceProvider services, IConfiguration config)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;

        var db = sp.GetRequiredService<AppDbContext>();
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("DbSeeder");

        try
        {
            await db.Database.MigrateAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Database migration failed. Check ConnectionStrings:Default.");
            return;
        }

        var roleManager = sp.GetRequiredService<RoleManager<AppRole>>();
        foreach (var role in Roles.All)
        {
            if (!await roleManager.RoleExistsAsync(role))
                await roleManager.CreateAsync(new AppRole(role));
        }

        var adminEmail = config["Seed:AdminEmail"];
        var adminPassword = config["Seed:AdminPassword"];
        if (string.IsNullOrWhiteSpace(adminEmail) || string.IsNullOrWhiteSpace(adminPassword))
        {
            logger.LogInformation("No Seed:AdminEmail/Seed:AdminPassword configured — skipping admin creation.");
            return;
        }

        var users = sp.GetRequiredService<UserManager<AppUser>>();
        if (await users.FindByEmailAsync(adminEmail) is not null) return;

        var admin = new AppUser
        {
            UserName = adminEmail,
            Email = adminEmail,
            DisplayName = "Administrator",
            EmailConfirmed = true,
        };

        var created = await users.CreateAsync(admin, adminPassword);
        if (created.Succeeded)
        {
            await users.AddToRoleAsync(admin, Roles.Admin);
            logger.LogInformation("Seeded administrator {Email}.", adminEmail);
        }
        else
        {
            logger.LogError("Could not seed administrator: {Errors}",
                string.Join("; ", created.Errors.Select(e => e.Description)));
        }
    }
}
