using System.Text.Json;
using Azure.Storage.Queues;

namespace Configurator.Api.Services;

/// <summary>
/// One angle's worth of layer rendering. Deliberately small — the worker fetches the
/// model, the camera pose and the parsed schedule from the API, so a message that sat
/// in the queue for an hour still renders against current data.
/// </summary>
public record RenderJob(Guid ModelId, Guid CaptureId, Guid ScheduleId);

public interface IRenderJobQueue
{
    Task EnqueueAsync(RenderJob job, CancellationToken ct = default);
}

public class QueueOptions
{
    public string ConnectionString { get; set; } = string.Empty;
    public string QueueName { get; set; } = "render-jobs";
}

public class AzureQueueRenderJobQueue : IRenderJobQueue
{
    private readonly QueueClient _queue;

    public AzureQueueRenderJobQueue(QueueOptions options)
    {
        _queue = new QueueClient(options.ConnectionString, options.QueueName,
            new QueueClientOptions { MessageEncoding = QueueMessageEncoding.Base64 });
        _queue.CreateIfNotExists();
    }

    public async Task EnqueueAsync(RenderJob job, CancellationToken ct = default)
        => await _queue.SendMessageAsync(JsonSerializer.Serialize(job), ct);
}

/// <summary>
/// Used when no queue is configured, so the API runs without Azure for a first pass.
/// Jobs are recorded and dropped; captures stay Queued until a real worker exists.
/// </summary>
public class NullRenderJobQueue : IRenderJobQueue
{
    private readonly ILogger<NullRenderJobQueue> _log;
    public NullRenderJobQueue(ILogger<NullRenderJobQueue> log) => _log = log;

    public Task EnqueueAsync(RenderJob job, CancellationToken ct = default)
    {
        _log.LogWarning(
            "Render job for capture {CaptureId} was dropped: no queue configured (Storage:QueueConnectionString).",
            job.CaptureId);
        return Task.CompletedTask;
    }
}
