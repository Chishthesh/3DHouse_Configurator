using System.Text;
using Configurator.Api.Data;
using Configurator.Api.Domain;
using Configurator.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

// --- Data -------------------------------------------------------------------------
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("Default")));

// --- Identity ---------------------------------------------------------------------
builder.Services
    .AddIdentity<AppUser, AppRole>(options =>
    {
        options.Password.RequiredLength = 10;
        options.Password.RequireNonAlphanumeric = false;
        options.User.RequireUniqueEmail = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwt.SigningKey))
{
    // Refuse to start rather than silently signing tokens with an empty key.
    if (builder.Environment.IsDevelopment())
        jwt.SigningKey = "dev-only-signing-key-change-me-0123456789abcdef";
    else
        throw new InvalidOperationException("Jwt:SigningKey is not configured.");
}
builder.Services.AddSingleton(jwt);
builder.Services.AddSingleton<ITokenService, TokenService>();

builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
            ClockSkew = TimeSpan.FromMinutes(1),
        };
    });

// Role-based policies, named after what they allow rather than who holds them.
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(Roles.CanManageModels, p => p.RequireRole(Roles.Admin, Roles.Artist));
    options.AddPolicy(Roles.CanPublish, p => p.RequireRole(Roles.Admin, Roles.Artist, Roles.Analyst));
    options.AddPolicy(Roles.CanConfigure, p => p.RequireRole(Roles.Admin, Roles.Analyst, Roles.Customer));
});

// --- Storage and queue --------------------------------------------------------------
var blobOptions = builder.Configuration.GetSection("Storage").Get<BlobStorageOptions>() ?? new BlobStorageOptions();
builder.Services.AddSingleton(blobOptions);
builder.Services.AddSingleton<IBlobStorage>(_ => new AzureBlobStorage(blobOptions));

var queueOptions = builder.Configuration.GetSection("Queue").Get<QueueOptions>() ?? new QueueOptions();
builder.Services.AddSingleton(queueOptions);
if (string.IsNullOrWhiteSpace(queueOptions.ConnectionString))
    builder.Services.AddSingleton<IRenderJobQueue, NullRenderJobQueue>();
else
    builder.Services.AddSingleton<IRenderJobQueue>(_ => new AzureQueueRenderJobQueue(queueOptions));

// --- Web ------------------------------------------------------------------------------
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "Configurator API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
                  ?? new[] { "http://localhost:5173", "http://localhost:5174" };
builder.Services.AddCors(o => o.AddPolicy("web", p => p
    .WithOrigins(corsOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("web");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok", utc = DateTimeOffset.UtcNow }));

await DbSeeder.SeedAsync(app.Services, app.Configuration);

app.Run();
