using Configurator.Api.Domain;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Configurator.Api.Data;

public class AppDbContext : IdentityDbContext<AppUser, AppRole, Guid>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ModelAsset> Models => Set<ModelAsset>();
    public DbSet<Capture> Captures => Set<Capture>();
    public DbSet<CaptureLayer> CaptureLayers => Set<CaptureLayer>();
    public DbSet<Schedule> Schedules => Set<Schedule>();
    public DbSet<SavedConfiguration> SavedConfigurations => Set<SavedConfiguration>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<Project>(e =>
        {
            e.Property(x => x.Name).IsRequired().HasMaxLength(200);
            e.HasIndex(x => x.Name);
        });

        b.Entity<ModelAsset>(e =>
        {
            e.Property(x => x.Name).IsRequired().HasMaxLength(260);
            e.Property(x => x.BlobPath).IsRequired().HasMaxLength(1024);
            e.Property(x => x.ContentHash).HasMaxLength(64);
            e.HasOne(x => x.Project).WithMany(p => p.Models)
                .HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.ProjectId, x.Status });
        });

        b.Entity<Capture>(e =>
        {
            e.Property(x => x.Name).IsRequired().HasMaxLength(200);
            e.Property(x => x.BaseImagePath).IsRequired().HasMaxLength(1024);
            e.HasOne(x => x.Model).WithMany(m => m.Captures)
                .HasForeignKey(x => x.ModelId).OnDelete(DeleteBehavior.Cascade);
            // The configurator lists published captures for a model in display order.
            e.HasIndex(x => new { x.ModelId, x.Status, x.SortOrder });
        });

        b.Entity<CaptureLayer>(e =>
        {
            e.Property(x => x.NodeName).IsRequired().HasMaxLength(256);
            e.Property(x => x.OptionKey).IsRequired().HasMaxLength(256);
            e.Property(x => x.ImagePath).IsRequired().HasMaxLength(1024);
            e.HasOne(x => x.Capture).WithMany(c => c.Layers)
                .HasForeignKey(x => x.CaptureId).OnDelete(DeleteBehavior.Cascade);
            // One image per part per option per angle; the unique index makes a
            // re-run of the render job idempotent instead of duplicating rows.
            e.HasIndex(x => new { x.CaptureId, x.NodeName, x.OptionKey }).IsUnique();
        });

        b.Entity<Schedule>(e =>
        {
            e.Property(x => x.FileName).IsRequired().HasMaxLength(260);
            e.Property(x => x.BlobPath).IsRequired().HasMaxLength(1024);
            e.HasOne(x => x.Model).WithOne(m => m.Schedule)
                .HasForeignKey<Schedule>(x => x.ModelId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.ModelId, x.IsCurrent });
        });

        b.Entity<SavedConfiguration>(e =>
        {
            e.Property(x => x.Name).IsRequired().HasMaxLength(200);
            e.HasOne(x => x.Model).WithMany()
                .HasForeignKey(x => x.ModelId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.OwnerUserId, x.ModelId });
        });
    }
}
