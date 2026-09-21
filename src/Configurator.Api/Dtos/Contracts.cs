using Configurator.Api.Domain;

namespace Configurator.Api.Dtos;

// --- Auth ------------------------------------------------------------------------

public record LoginRequest(string Email, string Password);
public record RegisterRequest(string Email, string Password, string DisplayName, string? Role);
public record AuthResponse(string AccessToken, DateTimeOffset ExpiresAt, UserDto User);
public record UserDto(Guid Id, string Email, string DisplayName, string[] Roles);

// --- Projects ---------------------------------------------------------------------

public record ProjectDto(Guid Id, string Name, string? Description, int ModelCount, DateTimeOffset CreatedAt);
public record CreateProjectRequest(string Name, string? Description);

// --- Models -----------------------------------------------------------------------

/// <summary>
/// Returned by the list view of module 1. Counts let the UI show "12 captures,
/// 8 published" without a second round trip.
/// </summary>
public record ModelListItemDto(
    Guid Id,
    Guid ProjectId,
    string Name,
    long SizeBytes,
    int Version,
    ModelStatus Status,
    int CaptureCount,
    int PublishedCaptureCount,
    bool HasSchedule,
    DateTimeOffset UploadedAt);

public record ModelDetailDto(
    Guid Id,
    Guid ProjectId,
    string Name,
    long SizeBytes,
    int Version,
    ModelStatus Status,
    string DownloadUrl,
    int NodeCount,
    int MeshCount,
    int MaterialCount,
    int TextureCount,
    ScheduleDto? Schedule,
    DateTimeOffset UploadedAt);

/// <summary>
/// Step 1 of a two-step upload: the API reserves the row and returns a SAS URL, the
/// browser PUTs the .glb straight to Blob, then calls Complete. Keeps large binaries
/// off the API entirely.
/// </summary>
public record CreateModelRequest(Guid ProjectId, string FileName, long SizeBytes);
public record CreateModelResponse(Guid ModelId, string UploadUrl, string BlobPath, DateTimeOffset ExpiresAt);

/// <summary>Step 2: the browser reports what it parsed out of the .glb.</summary>
public record CompleteModelUploadRequest(
    int NodeCount, int MeshCount, int MaterialCount, int TextureCount, string? ContentHash);

// --- Schedules ---------------------------------------------------------------------

public record ScheduleDto(
    Guid Id, string FileName, int Version, int GroupCount, int OptionCount, DateTimeOffset UploadedAt);

/// <summary>
/// The workbook is parsed in the browser by the existing reader, so the API stores both
/// the original file and the normalised result. The render worker and the configurator
/// then read identical option data without either re-implementing the parser.
/// </summary>
public record AttachScheduleRequest(string FileName, string ParsedJson, int GroupCount, int OptionCount);
public record AttachScheduleResponse(Guid ScheduleId, string UploadUrl, string BlobPath, DateTimeOffset ExpiresAt);

// --- Captures -----------------------------------------------------------------------

public record CameraPoseDto(
    double CameraX, double CameraY, double CameraZ,
    double TargetX, double TargetY, double TargetZ,
    double FieldOfView);

public record CreateCaptureRequest(
    string Name,
    int SortOrder,
    int Width,
    int Height,
    CaptureTier Tier,
    CameraPoseDto Pose,
    string[] VisibleNodes,
    string[] ConfigurableNodes);

/// <summary>Reserves the capture and hands back SAS URLs for the base image and thumbnail.</summary>
public record CreateCaptureResponse(
    Guid CaptureId, string BaseUploadUrl, string ThumbnailUploadUrl, DateTimeOffset ExpiresAt);

public record CaptureListItemDto(
    Guid Id,
    string Name,
    int SortOrder,
    CaptureStatus Status,
    CaptureTier Tier,
    LayerGenerationStatus LayerStatus,
    int LayerCount,
    string ThumbnailUrl,
    string[] VisibleNodes,
    DateTimeOffset CreatedAt);

/// <summary>What the 2D configurator needs to render one angle.</summary>
public record CaptureViewDto(
    Guid Id,
    string Name,
    int SortOrder,
    int Width,
    int Height,
    string BaseImageUrl,
    string[] VisibleNodes,
    string[] ConfigurableNodes,
    LayerDto[] Layers);

public record LayerDto(string NodeName, string OptionKey, string ImageUrl);

public record UpdateCaptureRequest(string? Name, int? SortOrder, CaptureTier? Tier, string[]? ConfigurableNodes);

/// <summary>Bulk publish — the "Save All" action at the end of a capture session.</summary>
public record PublishCapturesRequest(Guid[] CaptureIds, bool GenerateLayers);
public record PublishCapturesResponse(int PublishedCount, int QueuedForLayers);

// --- Layers (written by the render worker) ---------------------------------------------

public record RegisterLayerRequest(string NodeName, string OptionKey, long SizeBytes);
public record RegisterLayerResponse(Guid LayerId, string UploadUrl, string BlobPath, DateTimeOffset ExpiresAt);
public record ReportLayerStatusRequest(LayerGenerationStatus Status, string? Error);

// --- Saved configurations ---------------------------------------------------------------

public record SelectionDto(string NodeName, string OptionKey, string? OptionName, string? Color, string? Texture);
public record SaveConfigurationRequest(Guid ModelId, string Name, SelectionDto[] Selections);
public record ConfigurationDto(
    Guid Id, Guid ModelId, string Name, SelectionDto[] Selections, DateTimeOffset UpdatedAt);
