import * as THREE from 'three';
import { meshesForScope } from './nodeGraph.js';

/**
 * Renders the per-option layer images the 2D configurator composites.
 *
 * This is the job the architecture assigns to a render worker. It runs in the
 * browser instead, in the capture studio, because everything it needs is already
 * here — the loaded .glb, the material editor, the node graph and the camera. A
 * separate headless service would be a second copy of all of it, kept in step by
 * hand, to produce identical pixels.
 *
 * One layer is one node wearing one option, cut to that node's silhouette and
 * transparent everywhere else, so the configurator can stack any combination over
 * the base image. That is what keeps ten parts with five options each at fifty
 * images rather than five-to-the-tenth.
 */

const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const BLACK = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });

/**
 * Renders the silhouette of `targets` as white on black.
 *
 * Every other mesh is painted black rather than hidden, so the depth buffer still
 * holds them and anything in front of the target correctly cuts into the mask. Hide
 * them instead and a layer would paint straight over the island that occludes it.
 */
function renderMask(gl, scene, camera, targets, out) {
  const set = new Set(targets);
  const saved = [];

  scene.traverse((obj) => {
    if (!obj.isMesh || obj.userData?.__configuratorHelper) return;
    saved.push([obj, obj.material]);
    obj.material = set.has(obj) ? WHITE : BLACK;
  });

  const prevBackground = scene.background;
  const prevEnvironment = scene.environment;
  scene.background = new THREE.Color(0x000000);
  scene.environment = null;

  gl.render(scene, camera);
  out.ctx.drawImage(gl.domElement, 0, 0, out.canvas.width, out.canvas.height);
  const mask = out.ctx.getImageData(0, 0, out.canvas.width, out.canvas.height);

  scene.background = prevBackground;
  scene.environment = prevEnvironment;
  for (const [obj, material] of saved) obj.material = material;

  return mask;
}

/** Draws the scene as it really looks, and returns its pixels. */
function renderColour(gl, scene, camera, out) {
  gl.render(scene, camera);
  out.ctx.drawImage(gl.domElement, 0, 0, out.canvas.width, out.canvas.height);
  return out.ctx.getImageData(0, 0, out.canvas.width, out.canvas.height);
}

/** Colour pixels, made transparent wherever the mask is dark. */
function cutout(colour, mask, out) {
  const c = colour.data;
  const m = mask.data;
  for (let i = 0; i < c.length; i += 4) {
    // The mask is greyscale, so any channel will do; red is as good as luminance
    // here and avoids three multiplies per pixel across a few million pixels.
    c[i + 3] = m[i];
  }
  out.ctx.putImageData(colour, 0, 0);
  return out.canvas;
}

function toBlob(canvas, type = 'image/webp', quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the browser produced no image'))),
      type,
      quality
    );
  });
}

/**
 * Which options apply to a node, by name. Module 2 matches the same way, so the
 * optionKey stored here is exactly the one it will look up.
 */
function optionsForNode(library, nodeName) {
  if (!library) return [];
  const out = [];
  for (const group of library.groups) {
    if (group.excludePatterns.some((p) => p.test(nodeName))) continue;
    if (!group.nodePatterns.some((p) => p.test(nodeName))) continue;
    for (const option of group.options) out.push(option);
  }
  // A schedule can name the same option code in two groups that both match; the
  // layer is keyed on (node, code), so rendering it twice would just overwrite.
  //
  // An option with no key is dropped rather than sent: the key becomes the layer's
  // file name, and an empty one collapses every option for that part onto a single
  // image. Parsing guarantees a key, so this only fires for hand-made data.
  const seen = new Set();
  return out.filter((o) => {
    if (!o.code) return false;
    if (seen.has(o.code)) return false;
    seen.add(o.code);
    return true;
  });
}

/** How many layers a run will produce, so the UI can show real progress. */
export function countLayers({ graph, library, nodeNames }) {
  if (!graph || !library) return 0;
  let total = 0;
  for (const name of nodeNames ?? []) {
    const node = graph.nodes.find((n) => n.name === name);
    if (!node) continue;
    total += optionsForNode(library, name).length;
  }
  return total;
}

/**
 * Renders and uploads every layer for one capture.
 *
 * `upload` is called with each finished layer so the caller owns the API calls and
 * this stays a pure rendering concern.
 */
export async function renderCaptureLayers({
  viewer,
  graph,
  editor,
  library,
  pose,
  width,
  height,
  nodeNames,
  hasOwnFinishes,
  upload,
  onProgress,
  shouldStop,
}) {
  const three = viewer?.getThree?.();
  if (!three) throw new Error('the 3D scene is not ready');
  if (!graph || !editor || !library) throw new Error('the model and its schedule must both be loaded');

  const { gl, scene, camera } = three;

  // Render at the capture's own pixel size. The configurator lays base and layers
  // over one another with object-fit, so a different aspect ratio would misalign
  // every overlay by a few pixels at the edges.
  const canvas = document.createElement('canvas');
  canvas.width = width || gl.domElement.width;
  canvas.height = height || gl.domElement.height;
  const out = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };

  const previousSize = new THREE.Vector2();
  gl.getSize(previousSize);
  const previousAspect = camera.aspect;
  const previousPixelRatio = gl.getPixelRatio();

  // Freeze the view on the pose this capture was taken from.
  viewer.applyPose?.(pose);
  gl.setPixelRatio(1);
  gl.setSize(canvas.width, canvas.height, false);
  camera.aspect = canvas.width / canvas.height;
  camera.updateProjectionMatrix();

  // Work out the whole job first, so progress can be reported against a real total
  // rather than counting up from nothing.
  const plan = [];
  let total = 0;
  for (const nodeName of nodeNames) {
    const node = graph.nodes.find((n) => n.name === nodeName);
    if (!node) continue;

    const options = optionsForNode(library, nodeName);
    if (options.length === 0) continue;

    const meshes = meshesForScope(graph, node, 'smart', hasOwnFinishes);
    // A grouping node whose sub-parts each carry their own finishes has no surface
    // of its own — nothing to tint, so nothing to render.
    if (meshes.length === 0) continue;

    plan.push({ nodeName, options, meshes });
    total += options.length;
  }

  const done = [];
  const failures = [];
  let index = 0;

  try {
    onProgress?.({ index: 0, total, nodeName: '', optionName: 'preparing' });

    for (const { nodeName, options, meshes } of plan) {
      if (shouldStop?.()) break;

      const mask = renderMask(gl, scene, camera, meshes, out);

      for (const option of options) {
        if (shouldStop?.()) break;
        index += 1;
        onProgress?.({ index, total, nodeName, optionName: option.name ?? option.code });

        try {
          await editor.applyOption(meshes, option);
          const colour = renderColour(gl, scene, camera, out);
          const blob = await toBlob(cutout(colour, mask, out));
          await upload({ nodeName, optionKey: option.code, blob });
          done.push(`${nodeName}:${option.code}`);
        } catch (err) {
          failures.push(`${nodeName} / ${option.name ?? option.code}: ${err.message}`);
        }
      }

      // Put the part back to the finish in the file before moving on, so the next
      // node's mask and colour passes are not rendered over a stale override.
      editor.resetMeshes(meshes);
    }
  } finally {
    editor.resetAll();
    gl.setPixelRatio(previousPixelRatio);
    gl.setSize(previousSize.x, previousSize.y, false);
    camera.aspect = previousAspect;
    camera.updateProjectionMatrix();
  }

  return { rendered: done.length, failures };
}
