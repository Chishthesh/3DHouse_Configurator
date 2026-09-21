using Azure.Storage;
using Azure.Storage.Blobs;
using Azure.Storage.Sas;

namespace Configurator.Api.Services;

public record UploadTicket(string BlobPath, string UploadUrl, DateTimeOffset ExpiresAt);

public interface IBlobStorage
{
    /// <summary>
    /// A short-lived write URL. The browser PUTs the bytes straight to Blob Storage;
    /// the API only records the path afterwards. At ~2,000 layer images per model,
    /// streaming those through the API would waste bandwidth and hold connections open
    /// for no benefit.
    /// </summary>
    UploadTicket CreateUploadTicket(string blobPath, TimeSpan? lifetime = null);

    /// <summary>A short-lived read URL for a private blob.</summary>
    string CreateReadUrl(string blobPath, TimeSpan? lifetime = null);

    Task<bool> ExistsAsync(string blobPath, CancellationToken ct = default);
    Task DeleteAsync(string blobPath, CancellationToken ct = default);
    Task DeletePrefixAsync(string prefix, CancellationToken ct = default);
    Task<Stream> OpenReadAsync(string blobPath, CancellationToken ct = default);
    Task UploadAsync(string blobPath, Stream content, string contentType, CancellationToken ct = default);
}

public class BlobStorageOptions
{
    public string ConnectionString { get; set; } = string.Empty;
    public string Container { get; set; } = "configurator";
    /// <summary>Optional CDN or Front Door host placed in front of the container.</summary>
    public string? PublicBaseUrl { get; set; }
    public int UploadUrlMinutes { get; set; } = 30;
    public int ReadUrlMinutes { get; set; } = 60;
}

public class AzureBlobStorage : IBlobStorage
{
    private readonly BlobContainerClient _container;
    private readonly BlobStorageOptions _options;
    private readonly StorageSharedKeyCredential? _sharedKey;

    public AzureBlobStorage(BlobStorageOptions options)
    {
        _options = options;
        var service = new BlobServiceClient(options.ConnectionString);
        _container = service.GetBlobContainerClient(options.Container);
        _container.CreateIfNotExists();

        // Service SAS needs the account key. In Azure, prefer a managed identity and a
        // user delegation SAS instead — same call shape, no secret in configuration.
        _sharedKey = TryParseSharedKey(options.ConnectionString);
    }

    public UploadTicket CreateUploadTicket(string blobPath, TimeSpan? lifetime = null)
    {
        var expires = DateTimeOffset.UtcNow.Add(lifetime ?? TimeSpan.FromMinutes(_options.UploadUrlMinutes));
        var url = Sas(blobPath, BlobSasPermissions.Write | BlobSasPermissions.Create, expires);
        return new UploadTicket(blobPath, url, expires);
    }

    public string CreateReadUrl(string blobPath, TimeSpan? lifetime = null)
    {
        var expires = DateTimeOffset.UtcNow.Add(lifetime ?? TimeSpan.FromMinutes(_options.ReadUrlMinutes));
        return Sas(blobPath, BlobSasPermissions.Read, expires);
    }

    private string Sas(string blobPath, BlobSasPermissions permissions, DateTimeOffset expires)
    {
        var blob = _container.GetBlobClient(blobPath);

        if (_sharedKey is null)
        {
            // No key available (managed identity). Return the plain URL; the caller is
            // expected to be reading through an authenticated path or a CDN.
            return blob.Uri.ToString();
        }

        var builder = new BlobSasBuilder
        {
            BlobContainerName = _container.Name,
            BlobName = blobPath,
            Resource = "b",
            ExpiresOn = expires,
            // Small backdate absorbs clock skew between the API host and Azure.
            StartsOn = DateTimeOffset.UtcNow.AddMinutes(-5),
        };
        builder.SetPermissions(permissions);

        var sas = builder.ToSasQueryParameters(_sharedKey).ToString();
        var baseUri = string.IsNullOrWhiteSpace(_options.PublicBaseUrl)
            ? blob.Uri.ToString()
            : $"{_options.PublicBaseUrl!.TrimEnd('/')}/{_container.Name}/{blobPath}";

        return $"{baseUri}?{sas}";
    }

    public async Task<bool> ExistsAsync(string blobPath, CancellationToken ct = default)
        => await _container.GetBlobClient(blobPath).ExistsAsync(ct);

    public async Task DeleteAsync(string blobPath, CancellationToken ct = default)
        => await _container.GetBlobClient(blobPath).DeleteIfExistsAsync(cancellationToken: ct);

    public async Task DeletePrefixAsync(string prefix, CancellationToken ct = default)
    {
        await foreach (var item in _container.GetBlobsAsync(prefix: prefix, cancellationToken: ct))
        {
            await _container.GetBlobClient(item.Name).DeleteIfExistsAsync(cancellationToken: ct);
        }
    }

    public async Task<Stream> OpenReadAsync(string blobPath, CancellationToken ct = default)
        => await _container.GetBlobClient(blobPath).OpenReadAsync(cancellationToken: ct);

    public async Task UploadAsync(string blobPath, Stream content, string contentType, CancellationToken ct = default)
    {
        var blob = _container.GetBlobClient(blobPath);
        await blob.UploadAsync(content, new Azure.Storage.Blobs.Models.BlobUploadOptions
        {
            HttpHeaders = new Azure.Storage.Blobs.Models.BlobHttpHeaders { ContentType = contentType }
        }, ct);
    }

    private static StorageSharedKeyCredential? TryParseSharedKey(string connectionString)
    {
        string? account = null, key = null;
        foreach (var part in connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var i = part.IndexOf('=');
            if (i <= 0) continue;
            var name = part[..i].Trim();
            var value = part[(i + 1)..].Trim();
            if (name.Equals("AccountName", StringComparison.OrdinalIgnoreCase)) account = value;
            else if (name.Equals("AccountKey", StringComparison.OrdinalIgnoreCase)) key = value;
        }
        return account is not null && key is not null ? new StorageSharedKeyCredential(account, key) : null;
    }
}

/// <summary>
/// Stands in when Storage:ConnectionString is not set, so the API is usable before
/// Azure is wired up. Endpoints that only read the database keep working; anything
/// that genuinely needs a URL fails with a message naming the missing setting rather
/// than an ArgumentNullException thrown from inside the Azure SDK.
/// </summary>
public class UnconfiguredBlobStorage : IBlobStorage
{
    private const string Message =
        "Azure Blob Storage is not configured. Set Storage:ConnectionString (and Storage:Container) " +
        "in appsettings.Development.json or user secrets.";

    private static InvalidOperationException Fail() => new(Message);

    public UploadTicket CreateUploadTicket(string blobPath, TimeSpan? lifetime = null) => throw Fail();
    public string CreateReadUrl(string blobPath, TimeSpan? lifetime = null) => throw Fail();
    public Task<bool> ExistsAsync(string blobPath, CancellationToken ct = default) => throw Fail();
    public Task DeleteAsync(string blobPath, CancellationToken ct = default) => throw Fail();
    public Task DeletePrefixAsync(string prefix, CancellationToken ct = default) => throw Fail();
    public Task<Stream> OpenReadAsync(string blobPath, CancellationToken ct = default) => throw Fail();
    public Task UploadAsync(string blobPath, Stream content, string contentType, CancellationToken ct = default)
        => throw Fail();
}

/// <summary>Canonical blob paths, kept in one place so the API and the render worker agree.</summary>
public static class BlobPaths
{
    public static string Model(Guid modelId, string fileName) => $"models/{modelId}/{Sanitise(fileName)}";
    public static string Schedule(Guid scheduleId, string fileName) => $"schedules/{scheduleId}/{Sanitise(fileName)}";
    public static string CaptureBase(Guid captureId) => $"captures/{captureId}/base.webp";
    public static string CaptureThumb(Guid captureId) => $"captures/{captureId}/thumb.webp";
    public static string CaptureLayer(Guid captureId, string nodeName, string optionKey)
        => $"captures/{captureId}/layers/{Sanitise(nodeName)}__{Sanitise(optionKey)}.webp";
    public static string CapturePrefix(Guid captureId) => $"captures/{captureId}/";
    public static string ModelPrefix(Guid modelId) => $"models/{modelId}/";

    private static string Sanitise(string value)
    {
        var chars = value.Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_' ? c : '-');
        return new string(chars.ToArray());
    }
}
