import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { findZoneForObject } from '../utils/zoneResolve.js';

// Any mesh named like "*_mirror" gets a real-time reflective material instead of a
// flat tinted one. Built entirely on core three.js (CubeCamera + WebGLCubeRenderTarget)
// rather than the three/examples Reflector addon, which pulls in a second copy of the
// three.js module in this bundler setup and silently breaks the R3F render tree.
function findMirrorMeshes(root) {
  const targets = [];
  root.traverse((obj) => {
    if (obj.isMesh && !obj.userData.isMirror && /mirror$/i.test(obj.name)) {
      targets.push(obj);
    }
  });
  return targets;
}

function MirrorSystem({ sceneRoot }) {
  const { gl, scene } = useThree();
  const mirrorsRef = useRef([]);

  useEffect(() => {
    if (!sceneRoot) return undefined;
    const meshes = findMirrorMeshes(sceneRoot);
    const mirrors = meshes.map((mesh) => {
      const renderTarget = new THREE.WebGLCubeRenderTarget(256);
      const cubeCamera = new THREE.CubeCamera(0.05, 50, renderTarget);
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

function Model({ url, onZoneClick, onSceneReady }) {
  const gltf = useGLTF(url);

  useEffect(() => {
    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    onSceneReady?.(gltf.scene);
  }, [gltf]);

  const handleClick = (e) => {
    e.stopPropagation();
    const zoneKey = findZoneForObject(e.object);
    onZoneClick(zoneKey, e.object.name);
  };

  return <primitive object={gltf.scene} onClick={handleClick} />;
}

function Ground({ onZoneClick, y }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y, 0]}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onZoneClick(null, null);
      }}
    >
      <planeGeometry args={[500, 500]} />
      <meshStandardMaterial color="#8fb96b" roughness={1} />
    </mesh>
  );
}

function CameraRig({ flyTo, controlsRef }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!flyTo) return;
    camera.position.set(...flyTo.position);
    if (controlsRef.current) {
      controlsRef.current.target.set(...flyTo.target);
      controlsRef.current.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo]);
  return null;
}

const SceneViewer = forwardRef(function SceneViewer({ glbUrl, flyTo, groundY, onZoneClick, onSceneReady }, ref) {
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const [modelRoot, setModelRoot] = useState(null);

  useImperativeHandle(ref, () => ({
    captureImage() {
      if (!rendererRef.current) return null;
      return rendererRef.current.domElement.toDataURL('image/png');
    },
    getCameraPose() {
      if (!cameraRef.current || !controlsRef.current) return null;
      return {
        position: cameraRef.current.position.toArray(),
        target: controlsRef.current.target.toArray(),
      };
    },
  }));

  return (
    <Canvas
      shadows="soft"
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [14, 10, 16], fov: 45, near: 0.05, far: 2000 }}
      onCreated={({ gl, camera }) => {
        rendererRef.current = gl;
        cameraRef.current = camera;
        gl.setClearColor(new THREE.Color('#bcdcf2'));
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      onPointerMissed={() => onZoneClick(null, null)}
    >
      <hemisphereLight args={['#dceaf5', '#8a8a78', 0.7]} />
      <directionalLight
        position={[10, 16, 8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-8, 10, -6]} intensity={0.4} />
      <Ground onZoneClick={onZoneClick} y={groundY ?? -0.05} />
      {glbUrl && (
        <Model
          url={glbUrl}
          onZoneClick={onZoneClick}
          onSceneReady={(scene) => {
            setModelRoot(scene);
            onSceneReady?.(scene);
          }}
        />
      )}
      <MirrorSystem sceneRoot={modelRoot} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={flyTo?.minDistance ?? 4}
        maxDistance={flyTo?.maxDistance ?? 45}
        enablePan={flyTo?.enablePan ?? true}
        target={[0, 1.2, 0]}
      />
      <CameraRig flyTo={flyTo} controlsRef={controlsRef} />
    </Canvas>
  );
});

export default SceneViewer;
