using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace Configurator.Api.Data;

/// <summary>
/// Used by `dotnet ef` at design time. Without it the tooling builds and partially
/// runs the web host, which would execute the startup seeder against a database that
/// may not exist yet — migrations should never depend on a reachable server.
/// </summary>
public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var config = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile("appsettings.Development.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connection = config.GetConnectionString("Default")
            ?? "Server=(localdb)\\MSSQLLocalDB;Database=ConfiguratorDb;Trusted_Connection=True;TrustServerCertificate=True";

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer(connection)
            .Options;

        return new AppDbContext(options);
    }
}
