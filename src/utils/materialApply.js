// Applying finishes to the loaded model.
//
// Callers pass the exact list of meshes to change (see meshesForScope in nodeGraph),
// so this module owns only *how* a finish is applied, never *where*.
//
// The important detail here is material isolation. In a real export, one material is
// shared across many parts: in the sample kitchen, "marble slab" is on the floor AND
// both counters, and "cabinets wood" is on the island, lower and upper cabinets. If
// the configurator mutated those materials in place, recolouring the floor would
// silently recolour the counters too. So the first time a mesh is edited, its
// material is cloned and the original kept for "Reset".
import * as THREE from 'three';

const textureCache = new Map();

function loadTexture(url) {
  if (textureCache.has(url)) return textureCache.get(url);
  const promise = new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        resolve(tex);
      },
      undefined,
      () => reject(new Error(`could not load ${url}`))
    );
  });
  textureCache.set(url, promise);
  return promise;
}

function asArray(material) {
  return Array.isArray(material) ? material : [material];
}

// A self-illuminated surface (an LED strip, a light panel) ships with a black base
// colour, so tinting .color would do nothing visible — tint the glow instead.
function isEmissiveDriven(mat) {
  const origColor = mat.userData.__origColor;
  const origEmissive = mat.userData.__origEmissive;
  return !!(origEmissive && origEmissive.getHex() !== 0 && origColor && origColor.getHex() === 0);
}

function setColor(mat, hex) {
  if (isEmissiveDriven(mat)) mat.emissive.set(hex);
  else if (mat.color) mat.color.set(hex);
}

export class MaterialEditor {
  constructor(root) {
    this.root = root;
    this.originals = new Map(); // mesh.uuid -> the material (or array) the file shipped with
    this.disposed = false;
  }

  /** Give this mesh its own material instances, remembering what it had. Idempotent. */
  _isolate(mesh) {
    if (this.originals.has(mesh.uuid)) return;
    const original = mesh.material;
    this.originals.set(mesh.uuid, original);
    const clones = asArray(original).map((mat) => {
      const clone = mat.clone();
      clone.name = mat.name;
      clone.userData = {
        ...clone.userData,
        __origColor: mat.color ? mat.color.clone() : null,
        __origEmissive: mat.emissive ? mat.emissive.clone() : null,
        __origMap: mat.map ?? null,
        __isConfiguratorClone: true,
      };
      return clone;
    });
    mesh.material = Array.isArray(original) ? clones : clones[0];
  }

  _materialsOf(meshes) {
    const mats = [];
    for (const mesh of meshes) {
      this._isolate(mesh);
      for (const mat of asArray(mesh.material)) if (mat) mats.push(mat);
    }
    return mats;
  }

  /** Apply one colour. Returns the number of meshes affected. */
  applyColor(meshes, hex) {
    for (const mat of this._materialsOf(meshes)) {
      setColor(mat, hex);
      mat.needsUpdate = true;
    }
    return meshes.length;
  }

  /**
   * Apply a full option from the material schedule: colour, roughness/metalness, and
   * a texture map if the option names one.
   *
   * An option with no texture is a solid finish, so any texture already on the
   * surface is cleared — otherwise "Matte Charcoal Paint" over a wood-grain cabinet
   * would come out as dark wood. `keepTexture: true` in the document opts out of
   * that, for options that mean "recolour the existing grain".
   */
  async applyOption(meshes, option) {
    let texture = null;
    let textureError = null;
    if (option.texture) {
      try {
        texture = await loadTexture(option.texture);
      } catch (err) {
        textureError = err.message;
      }
    }
    if (this.disposed) return { meshCount: 0, textureError: null };

    for (const mat of this._materialsOf(meshes)) {
      if (option.color) setColor(mat, option.color);
      if (option.roughness != null && 'roughness' in mat) mat.roughness = option.roughness;
      if (option.metalness != null && 'metalness' in mat) mat.metalness = option.metalness;
      if (option.opacity != null && option.opacity < 1) {
        mat.transparent = true;
        mat.opacity = option.opacity;
      }
      if ('map' in mat) {
        if (texture) {
          // Each surface needs its own tiling, so clone rather than sharing the
          // cached texture instance across every material that uses it.
          const t = texture.clone();
          t.needsUpdate = true;
          if (option.textureRepeat) t.repeat.set(option.textureRepeat[0], option.textureRepeat[1]);
          mat.map = t;
          // Show the texture, not the texture multiplied by a leftover tint, unless
          // the document deliberately gave both.
          if (mat.color && !option.color && !isEmissiveDriven(mat)) mat.color.set('#ffffff');
        } else if (option.keepTexture) {
          mat.map = mat.userData.__origMap ?? mat.map;
        } else {
          mat.map = null;
        }
      }
      mat.needsUpdate = true;
    }
    return { meshCount: meshes.length, textureError };
  }

  /**
   * Re-use a material that already exists elsewhere in this same .glb (e.g. put the
   * marble from the counters onto the backsplash). Needs no external assets, which
   * makes it the one finish swap that works for any uploaded file.
   */
  applyExistingMaterial(meshes, sourceMaterial) {
    for (const mesh of meshes) {
      this._isolate(mesh);
      const clone = sourceMaterial.clone();
      clone.name = sourceMaterial.name;
      clone.userData = {
        ...clone.userData,
        __origColor: sourceMaterial.color ? sourceMaterial.color.clone() : null,
        __origEmissive: sourceMaterial.emissive ? sourceMaterial.emissive.clone() : null,
        __origMap: sourceMaterial.map ?? null,
        __isConfiguratorClone: true,
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => clone) : clone;
    }
    return meshes.length;
  }

  /** Put the file's own materials back on these meshes. */
  resetMeshes(meshes) {
    let restored = 0;
    for (const mesh of meshes) {
      const original = this.originals.get(mesh.uuid);
      if (!original) continue;
      asArray(mesh.material).forEach((mat) => {
        if (mat?.userData?.__isConfiguratorClone) mat.dispose();
      });
      mesh.material = original;
      this.originals.delete(mesh.uuid);
      restored += 1;
    }
    return restored;
  }

  resetAll() {
    const meshes = [];
    this.root?.traverse((obj) => {
      if (obj.isMesh && this.originals.has(obj.uuid)) meshes.push(obj);
    });
    return this.resetMeshes(meshes);
  }

  dispose() {
    this.disposed = true;
    this.resetAll();
  }
}
