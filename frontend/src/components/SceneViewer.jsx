import React, { forwardRef, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

// Any mesh named like "*_mirror" gets a real-time reflective material instead of a
// flat tinted one. Built on core three.js (CubeCamera + WebGLCubeRenderTarget) rather
// than the three/examples Reflector addon, which pulls a second copy of the three.js
// module into this bundler setup and silently breaks the R3F render tree.
function findMirrorMeshes(root) {
  const targets = [];
  root.traverse((obj) => {
    if (obj.isMesh && !obj.userData.isMirror && /mirror$/i.test(obj.name)) targets.push(obj);
  });
  return targets;
}

function MirrorSystem({ sceneRoot }) {
  const { gl, scene } = useThree();
  const mirrorsRef = useRef([]);

  useEffect(() => {
    if (!sceneRoot) return undefined;
    const mirrors = findMirrorMeshes(sceneRoot).map((mesh) => {
      const renderTarget = new THREE.WebGLCubeRenderTarget(256);
      const cubeCamera = new THREE.CubeCamera(0.05, 500, renderTarget);
      // Flagged so the node graph and framing raycasts ignore it.
      cubeCamera.userData.__configuratorHelper = true;
      mesh.add(cubeCamera);
      mesh.material = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05, envMap: renderTarget.texture });
      mesh.userData.isMirror = true;
      return { mesh, cubeCamera, renderTarget };
    });
    mirrorsRef.current = mirrors;
    return () => {
      mirrors.forEach((m) => {
        m.renderTarget.dispose();
        m.mesh.remove(m.cubeCamera);
        m.mesh.userData.isMirror = false;
      });
      mirrorsRef.current = [];
    };
  }, [sceneRoot]);

  useFrame(() => {
    mirrorsRef.current.forEach(({ mesh, cubeCamera }) => {
      mesh.visible = false;
      cubeCamera.update(gl, scene);
      mesh.visible = true;
    });
  });

  return null;
}

// A neutral studio environment so metals and glossy stone read correctly. Loaded
// dynamically and failure-tolerant: without it the scene is lit by lights alone,
// which is dimmer but perfectly usable, and never a hard error.
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let disposed = false;
    let generated = null;
    import('three/examples/jsm/environments/RoomEnvironment.js')
      .then(({ RoomEnvironment }) => {
        if (disposed) return;
        const pmrem = new THREE.PMREMGenerator(gl);
        const envScene = new RoomEnvironment();
        generated = pmrem.fromScene(envScene, 0.04);
        scene.environment = generated.texture;
        pmrem.dispose();
        envScene.dispose?.();
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (scene.environment === generated?.texture) scene.environment = null;
      generated?.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Model({ url, onPick, onHover, onSceneReady }) {
  const gltf = useGLTF(url);

  useEffect(() => {
    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    onSceneReady?.(gltf.scene);
  }, [gltf, onSceneReady]);

  return (
    <primitive
      object={gltf.scene}
      onClick={(e) => {
        e.stopPropagation();
        onPick(e.object);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover?.(e.object, e.clientX, e.clientY);
      }}
      onPointerOut={() => onHover?.(null)}
    />
  );
}

function Ground({ y, radius, onMiss }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y, 0]}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onMiss();
      }}
    >
      <planeGeometry args={[radius * 24, radius * 24]} />
      <meshStandardMaterial color="#c9ccce" roughness={1} />
    </mesh>
  );
}

function SceneLights({ center, radius }) {
  const [cx, cy, cz] = center;
  const d = Math.max(radius, 1);
  return (
    <>
      <hemisphereLight args={['#e6eef5', '#8d8b84', 0.85]} />
      <directionalLight
        position={[cx + d * 0.9, cy + d * 1.5, cz + d * 0.8]}
        intensity={1.45}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-d * 1.3}
        shadow-camera-right={d * 1.3}
        shadow-camera-top={d * 1.3}
        shadow-camera-bottom={-d * 1.3}
        shadow-camera-near={0.1}
        shadow-camera-far={d * 6}
        shadow-bias={-0.0006}
        shadow-normalBias={d * 0.004}
      />
      <directionalLight position={[cx - d, cy + d, cz - d * 0.7]} intensity={0.45} />
      <directionalLight position={[cx, cy + d * 0.2, cz + d * 1.4]} intensity={0.25} />
    </>
  );
}

// Marks the currently selected part with an animated wireframe box. Deliberately a
// helper object rather than a material tweak: the material of the selected node is
// exactly what the user is about to edit, so highlighting must not touch it.
function SelectionBox({ box }) {
  const helper = useMemo(() => {
    if (!box) return null;
    const size = box.getSize(new THREE.Vector3()).length();
    const padded = box.clone().expandByScalar(Math.max(size * 0.012, 0.01));
    const h = new THREE.Box3Helper(padded, new THREE.Color('#ff8a3d'));
    h.userData.__configuratorHelper = true;
    h.material.depthTest = false;
    h.material.transparent = true;
    h.renderOrder = 999;
    return h;
  }, [box]);

  useFrame(({ clock }) => {
    if (helper) helper.material.opacity = 0.5 + 0.4 * Math.sin(clock.elapsedTime * 3.4);
  });

  useEffect(() => () => helper?.geometry?.dispose(), [helper]);
  if (!helper) return null;
  return <primitive object={helper} />;
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Animates the camera to a requested pose instead of snapping to it, which is what
 * makes selecting a part feel like being taken there. Details that matter:
 *
 *  - OrbitControls' own min/max distance clamp is widened for the duration of the
 *    flight, otherwise it fights the tween and the move stutters or stops short.
 *  - Any user input aborts the flight, so the camera never wrestles the mouse.
 */
function CameraRig({ flyTo, controlsRef, onFlyStateChange }) {
  const { camera } = useThree();
  const anim = useRef(null);
  const pending = useRef(null);

  const finalize = (limits) => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.minDistance = limits?.minDistance ?? 0.05;
    controls.maxDistance = limits?.maxDistance ?? 5000;
    controls.enablePan = limits?.enablePan ?? true;
    controls.update();
    onFlyStateChange?.(false);
  };

  useEffect(() => {
    const controls = controlsRef.current;
    if (!flyTo || !controls) return undefined;

    const from = camera.position.clone();
    const fromTarget = controls.target.clone();
    const to = new THREE.Vector3(...flyTo.position);
    const toTarget = new THREE.Vector3(...flyTo.target);
    const travel = from.distanceTo(to) + fromTarget.distanceTo(toTarget);
    const reference = Math.max(flyTo.maxDistance ?? 10, 1);

    pending.current = { minDistance: flyTo.minDistance, maxDistance: flyTo.maxDistance, enablePan: flyTo.enablePan };

    if (flyTo.instant || travel < 1e-4) {
      camera.position.copy(to);
      controls.target.copy(toTarget);
      finalize(pending.current);
      return undefined;
    }

    controls.minDistance = 0.001;
    controls.maxDistance = Infinity;
    onFlyStateChange?.(true);
    anim.current = {
      from,
      fromTarget,
      to,
      toTarget,
      // Progress is measured against the wall clock rather than accumulated frame
      // deltas. If the render loop stalls mid-flight — a backgrounded tab suspends
      // requestAnimationFrame — the camera would otherwise be stranded part-way and
      // then crawl the rest of the distance when frames resume. This way it arrives
      // on the first frame after the intended duration has elapsed.
      startedAt: performance.now(),
      dur: Math.min(1.5, Math.max(0.5, 0.4 + (travel / reference) * 0.85)) * 1000,
    };

    const abort = () => {
      if (!anim.current) return;
      anim.current = null;
      finalize(pending.current);
    };
    controls.addEventListener('start', abort);
    return () => controls.removeEventListener('start', abort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo]);

  useFrame(() => {
    const a = anim.current;
    const controls = controlsRef.current;
    if (!a || !controls) return;
    const t = Math.min(1, (performance.now() - a.startedAt) / a.dur);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(a.from, a.to, e);
    controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
    controls.update();
    if (t >= 1) {
      anim.current = null;
      finalize(pending.current);
    }
  });

  return null;
}

const SceneViewer = forwardRef(function SceneViewer(
  { glbUrl, flyTo, groundY, sceneCenter, sceneRadius, selectionBox, showGround, onPick, onHover, onMiss, onSceneReady, onFlyStateChange },
  ref
) {
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const sceneRefLocal = useRef(null);
  const controlsRef = useRef(null);
  const [modelRoot, setModelRoot] = useState(null);

  useImperativeHandle(ref, () => ({
    // preserveDrawingBuffer keeps the framebuffer readable after the frame is
    // presented, which is what makes toDataURL return pixels instead of black.
    /**
     * `width`/`height` render the shot at a size of the caller's choosing rather
     * than the size of the viewport. Captures are the customer-facing image and the
     * viewport is whatever the artist's window happens to be, so a capture taken at
     * viewport size arrives soft on any decent display.
     */
    captureImage({ width, height, type = 'image/png', quality } = {}) {
      const gl = rendererRef.current;
      const scene = sceneRefLocal.current;
      const camera = cameraRef.current;
      if (!gl || !scene || !camera) return null;

      if (!width || !height) {
        gl.render(scene, camera);
        return gl.domElement.toDataURL(type, quality);
      }

      const previousSize = new THREE.Vector2();
      gl.getSize(previousSize);
      const previousRatio = gl.getPixelRatio();
      const previousAspect = camera.aspect;

      // Rendered at 1:1 so the drawing buffer is exactly the size asked for; the
      // aspect ratio is unchanged, so the framing the artist lined up is preserved.
      gl.setPixelRatio(1);
      gl.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      gl.render(scene, camera);
      const url = gl.domElement.toDataURL(type, quality);

      gl.setPixelRatio(previousRatio);
      gl.setSize(previousSize.x, previousSize.y, false);
      camera.aspect = previousAspect;
      camera.updateProjectionMatrix();
      return url;
    },
    getCameraPose() {
      if (!cameraRef.current || !controlsRef.current) return null;
      return {
        position: cameraRef.current.position.toArray(),
        target: controlsRef.current.target.toArray(),
        fov: cameraRef.current.fov,
      };
    },
    /** Pixel dimensions of the image captureImage() would return. */
    getSize() {
      const canvas = rendererRef.current?.domElement;
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    },
    /**
     * The underlying three.js objects.
     *
     * Layer generation needs to drive the renderer directly — move the camera to a
     * stored pose, swap materials for a mask pass, render off the normal loop — and
     * doing that through a dozen bespoke methods would be worse than handing over
     * the objects. Callers must restore whatever they change.
     */
    getThree() {
      if (!rendererRef.current || !sceneRefLocal.current || !cameraRef.current) return null;
      return {
        gl: rendererRef.current,
        scene: sceneRefLocal.current,
        camera: cameraRef.current,
        controls: controlsRef.current,
        modelRoot,
      };
    },
    /**
     * Puts the camera exactly on a stored pose, with no tween.
     *
     * Deliberately does not call controls.update(). OrbitControls re-derives the
     * camera position from its own spherical state and clamps the radius to
     * minDistance/maxDistance — values left over from the last fly-to — so updating
     * here would quietly move the camera somewhere else. The caller disables the
     * controls for the duration instead.
     */
    applyPose(pose) {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !pose) return false;

      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      if (typeof pose.fov === 'number' && pose.fov > 0) camera.fov = pose.fov;
      if (controls) controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      return true;
    },
    /**
     * Which objects this shot actually shows, found by firing a ray through a grid
     * of screen positions and keeping the nearest hit at each one.
     *
     * A capture's node metadata has to describe what is *visible*, not what is in
     * the file: listing a dishwasher hidden behind an island would put an option in
     * the configurator that changes nothing the viewer can see. Sampling the depth
     * this way also naturally handles occlusion, which a frustum test does not.
     */
    sampleVisibleObjects(cols = 28, rows = 18) {
      const camera = cameraRef.current;
      if (!camera || !modelRoot) return [];

      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const seen = new Set();

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          // Sample cell centres so the grid never lands exactly on the frame edge.
          ndc.set(((col + 0.5) / cols) * 2 - 1, -(((row + 0.5) / rows) * 2 - 1));
          raycaster.setFromCamera(ndc, camera);
          const hit = raycaster
            .intersectObject(modelRoot, true)
            .find((i) => i.object?.visible && !i.object.userData?.__configuratorHelper);
          if (hit) seen.add(hit.object.uuid);
        }
      }
      return [...seen];
    },
  }));

  // Stable identities: these feed <primitive>/light props, and a fresh array every
  // render would re-apply them (and re-create the shadow camera) constantly.
  const radius = sceneRadius ?? 8;
  const center = useMemo(() => sceneCenter ?? [0, 1, 0], [sceneCenter]);

  return (
    <Canvas
      shadows="soft"
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [radius * 1.6, radius, radius * 1.6], fov: 45, near: 0.02, far: Math.max(4000, radius * 40) }}
      onCreated={({ gl, camera, scene }) => {
        rendererRef.current = gl;
        cameraRef.current = camera;
        sceneRefLocal.current = scene;
        gl.setClearColor(new THREE.Color('#cfdce8'));
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      onPointerMissed={() => onMiss?.()}
    >
      <StudioEnvironment />
      <SceneLights center={center} radius={radius} />
      {showGround && <Ground y={groundY ?? -0.05} radius={radius} onMiss={() => onMiss?.()} />}
      <Suspense fallback={null}>
        {glbUrl && (
          <Model
            key={glbUrl}
            url={glbUrl}
            onPick={onPick}
            onHover={onHover}
            onSceneReady={(scene) => {
              setModelRoot(scene);
              onSceneReady?.(scene);
            }}
          />
        )}
      </Suspense>
      <MirrorSystem sceneRoot={modelRoot} />
      <SelectionBox box={selectionBox} />
      {/* target / min / max are owned imperatively by CameraRig. Passing them as
          props here would make React re-apply them on every render and stomp the
          in-flight camera animation. */}
      <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.1} />
      <CameraRig flyTo={flyTo} controlsRef={controlsRef} onFlyStateChange={onFlyStateChange} />
    </Canvas>
  );
});

export default SceneViewer;
