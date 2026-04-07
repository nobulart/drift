"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, PerspectiveCamera } from "@react-three/drei";
import { memo, useState, useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useStore } from '@/store/useStore';
import { computePhysicalBasis, driftAxisLongitude, rotateZ, toSpherical, vectorLongitudeChart } from '@/lib/transforms';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

type AxesHelperProps = {
  args?: [number];
};

const AxesHelper = memo(function AxesHelper({ args = [1.5] }: AxesHelperProps) {
  const helper = useMemo(() => new THREE.AxesHelper(args[0]), [args]);
  return <primitive object={helper} />;
});

function Graticules({ radius = 0.5, interval = 5 }) {
  const rings = useMemo(() => {
    const lines = [];
    for (let lat = -90; lat <= 90; lat += interval) {
      const phi = (lat * Math.PI) / 180;
      const z = radius * Math.sin(phi);
      const r = radius * Math.cos(phi);
      if (r > 0.01) {
        lines.push({ type: 'lat', z, r });
      }
    }
    for (let lon = 0; lon < 360; lon += interval) {
      const theta = (lon * Math.PI) / 180;
      lines.push({ type: 'lon', theta });
    }
    return lines;
  }, [radius, interval]);

  return (
    <group>
      {rings.map((ring, i) => {
        if (ring.type === 'lat') {
          const r = ring.r ?? 0;
          const z = ring.z ?? 0;
          return (
            <mesh key={`lat-${i}`} position={[0, 0, z]}>
              <ringGeometry args={[r, r + 0.002, 64]} />
              <meshBasicMaterial color="#4a5568" side={THREE.DoubleSide} transparent opacity={0.3} />
            </mesh>
          );
        } else {
          const theta = ring.theta ?? 0;
          return (
            <mesh key={`lon-${i}`} rotation={[0, theta, 0]}>
              <ringGeometry args={[radius, radius + 0.002, 64]} />
              <meshBasicMaterial color="#4a5568" side={THREE.DoubleSide} transparent opacity={0.3} />
            </mesh>
          );
        }
      })}
    </group>
  );
}

interface VectorArrowProps {
  vector: [number, number, number];
  color: string;
  label: string;
  visible: boolean;
  positionOffset?: [number, number, number];
  pathData?: PathSample[];
}

type Vec3 = [number, number, number];
type PathSample = {
  t: number;
  vector: Vec3;
};

function toThreeVector(vector: Vec3): THREE.Vector3 {
  return new THREE.Vector3(vector[0], vector[1], vector[2]);
}

function toTuple(vector: THREE.Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}

function slerpVec(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const omega = Math.acos(dot);

  if (omega < 1e-6) return a.clone();

  const sinOmega = Math.sin(omega);
  const s1 = Math.sin((1 - t) * omega) / sinOmega;
  const s2 = Math.sin(t * omega) / sinOmega;

  return a.clone().multiplyScalar(s1).add(b.clone().multiplyScalar(s2)).normalize();
}

function unwrapLongitudes(lons: number[]) {
  if (lons.length === 0) {
    return [];
  }

  const out = [lons[0]];

  for (let i = 1; i < lons.length; i++) {
    let lon = lons[i];
    const prev = out[i - 1];
    const d = lon - prev;

    if (d > 180) lon -= 360;
    if (d < -180) lon += 360;

    out.push(lon);
  }

  return out;
}

function stabilizeOrientation(samples: PathSample[], allowFlip: boolean): PathSample[] {
  if (!allowFlip || samples.length === 0) {
    return samples.map((sample) => ({ ...sample, vector: [...sample.vector] as Vec3 }));
  }

  const stabilized: PathSample[] = [{ ...samples[0], vector: [...samples[0].vector] as Vec3 }];

  for (let i = 1; i < samples.length; i++) {
    const prev = toThreeVector(stabilized[stabilized.length - 1].vector).normalize();
    const current = toThreeVector(samples[i].vector).normalize();

    if (prev.dot(current) < 0) {
      current.multiplyScalar(-1);
    }

    stabilized.push({ ...samples[i], vector: toTuple(current) });
  }

  return stabilized;
}

function applyLongitudeContinuity(samples: PathSample[]): PathSample[] {
  if (samples.length === 0) {
    return [];
  }

  const spherical = samples.map((sample) => ({
    ...sample,
    spherical: toSpherical(sample.vector),
  }));
  const unwrappedLon = unwrapLongitudes(spherical.map((sample) => sample.spherical.lon));

  return spherical.map((sample, index) => {
    const lonRad = THREE.MathUtils.degToRad(unwrappedLon[index]);
    const latRad = THREE.MathUtils.degToRad(sample.spherical.lat);
    const vector = new THREE.Vector3(
      Math.cos(latRad) * Math.cos(lonRad),
      Math.cos(latRad) * Math.sin(lonRad),
      Math.sin(latRad)
    ).normalize();

    return {
      t: sample.t,
      vector: toTuple(vector),
    };
  });
}

function interpolateAtTime(samples: PathSample[], time: number): PathSample {
  if (samples.length === 0) {
    return { t: time, vector: [0, 0, 1] };
  }

  if (time <= samples[0].t) {
    return { t: time, vector: samples[0].vector };
  }

  const last = samples[samples.length - 1];
  if (time >= last.t) {
    return { t: time, vector: last.vector };
  }

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];

    if (time < a.t || time > b.t) {
      continue;
    }

    const span = b.t - a.t;
    const ratio = span <= 1e-6 ? 0 : (time - a.t) / span;
    const vector = slerpVec(
      toThreeVector(a.vector).normalize(),
      toThreeVector(b.vector).normalize(),
      THREE.MathUtils.clamp(ratio, 0, 1)
    );

    return { t: time, vector: toTuple(vector) };
  }

  return { t: time, vector: last.vector };
}

function resamplePath(samples: PathSample[], targetPoints = 32): PathSample[] {
  if (samples.length <= 1) {
    return samples;
  }

  const start = samples[0].t;
  const end = samples[samples.length - 1].t;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return samples;
  }

  const dt = (end - start) / Math.max(targetPoints - 1, 1);
  const result: PathSample[] = [];

  for (let time = start; time < end; time += dt) {
    result.push(interpolateAtTime(samples, time));
  }

  result.push({ t: end, vector: samples[samples.length - 1].vector });
  return result;
}

function filterJumps(samples: PathSample[], maxAngleDeg = 20): PathSample[] {
  if (samples.length <= 1) {
    return samples;
  }

  const maxAngle = THREE.MathUtils.degToRad(maxAngleDeg);
  const filtered: PathSample[] = [{ ...samples[0], vector: [...samples[0].vector] as Vec3 }];

  for (let i = 1; i < samples.length; i++) {
    const previous = toThreeVector(filtered[filtered.length - 1].vector).normalize();
    const current = toThreeVector(samples[i].vector).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(previous.dot(current), -1, 1));

    if (angle <= maxAngle) {
      filtered.push({ ...samples[i], vector: toTuple(current) });
    } else {
      filtered.push({ ...samples[i], vector: toTuple(slerpVec(previous, current, 0.5)) });
    }
  }

  return filtered;
}

function buildSlerpPath(points: THREE.Vector3[], steps = 8) {
  if (points.length <= 1) {
    return points;
  }

  const out: THREE.Vector3[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      out.push(slerpVec(a, b, t));
    }
  }

  out.push(points[points.length - 1].clone());
  return out;
}

function angularVelocity(a: THREE.Vector3, b: THREE.Vector3, dt: number) {
  const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  return angle / Math.max(dt, 1e-6);
}

function buildDiagnosticPath(
  samples: PathSample[],
  options?: { allowFlip?: boolean; maxAngleDeg?: number; targetPoints?: number; lift?: number }
) {
  if (samples.length <= 1) {
    return null;
  }

  const stabilized = stabilizeOrientation(samples, options?.allowFlip ?? false);
  const unwrapped = applyLongitudeContinuity(stabilized);
  const resampled = resamplePath(unwrapped, options?.targetPoints ?? 30);
  const filtered = filterJumps(resampled, options?.maxAngleDeg ?? 20);
  const greatCircle = buildSlerpPath(
    filtered.map((sample) => toThreeVector(sample.vector).normalize()),
    6
  ).map((point) => point.multiplyScalar(options?.lift ?? 1.015));

  if (greatCircle.length <= 1) {
    return null;
  }

  const curve = new THREE.CatmullRomCurve3(greatCircle, false, 'centripetal', 0.5);
  const smooth = curve.getPoints(Math.max(greatCircle.length * 4, 64));
  const geometry = new THREE.BufferGeometry().setFromPoints(smooth);
  const colors: number[] = [];
  const totalDuration = Math.max(filtered[filtered.length - 1].t - filtered[0].t, 1e-6);
  const dtSmooth = totalDuration / Math.max(smooth.length - 1, 1);
  const omegaValues = smooth.map((point, index) => {
    if (index === 0) {
      return 0;
    }

    return angularVelocity(
      smooth[index - 1].clone().normalize(),
      point.clone().normalize(),
      dtSmooth
    );
  });
  const maxOmega = Math.max(...omegaValues, 1e-6);

  for (let i = 0; i < smooth.length; i++) {
    const normalized = Math.min(omegaValues[i] / maxOmega, 1);
    const color = new THREE.Color().setHSL(0.7 - normalized * 0.7, 1.0, 0.5);
    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

const VectorArrow = memo(function VectorArrow({ vector, color, label, visible, positionOffset = [0, 0, 0], pathData = [] }: VectorArrowProps) {
  const [hovered, setHovered] = useState(false);
  const vecArray = vector as number[];
  const offset = positionOffset as [number, number, number];
  const pathGeometry = useMemo(() => {
    if (!pathData || pathData.length <= 1) {
      return null;
    }

    const geometry = buildDiagnosticPath(pathData, {
      allowFlip: label === 'e1' || label === 'e2',
      maxAngleDeg: label === 'Geomagnetic Dipole' ? 14 : 22,
      targetPoints: 30,
      lift: label === 'Geomagnetic Dipole' ? 1.025 : 1.015,
    });

    return geometry;
  }, [label, pathData]);

  if (!visible) return null;

  return (
    <group position={offset}>
      <Arrow vector={vector} color={color} />
      
      {pathGeometry && (
        <line>
          <primitive object={pathGeometry} attach="geometry" />
          <lineBasicMaterial vertexColors transparent opacity={0.6} depthWrite={false} depthTest />
        </line>
      )}

      <mesh
        position={[vecArray[0] * 1.1, vecArray[1] * 1.1, vecArray[2] * 1.1]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Text
        position={[vecArray[0] * 1.2, vecArray[1] * 1.2 + (hovered ? 0.15 : 0), vecArray[2] * 1.2]}
        color="white" fontSize={0.09} anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="black"
      >
        {label}
      </Text>
      {hovered && (
        <Text
          position={[vecArray[0] * 1.2, vecArray[1] * 1.2 - 0.1, vecArray[2] * 1.2]}
          color="#ffff00" fontSize={0.065} anchorX="center" anchorY="middle"
        >
          [{vecArray[0].toFixed(3)}, {vecArray[1].toFixed(3)}, {vecArray[2].toFixed(3)}]
        </Text>
      )}
    </group>
  );
});

const Arrow = memo(function Arrow({ vector, color }: { vector: [number, number, number]; color: string }) {
  const { rotationQuaternion, vectorLength } = useMemo(() => {
    const vec = vector as number[];
    const rotation = new THREE.Quaternion();
    const lookAt = new THREE.Vector3(vec[0], vec[1], vec[2]);
    const vectorLength = lookAt.length();

    if (lookAt.lengthSq() < 1e-10) {
      return { rotationQuaternion: rotation.identity(), vectorLength: 0 };
    }

    rotation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lookAt.normalize());
    return { rotationQuaternion: rotation, vectorLength };
  }, [vector]);

  const displayLength = Math.max(vectorLength, 0.001);
  const shaftLength = 0.72;
  const headLength = 0.22;

  return (
    <group quaternion={rotationQuaternion} scale={[displayLength, displayLength, displayLength]}>
      <mesh position={[0, shaftLength / 2, 0]}>
        <cylinderGeometry args={[0.018, 0.018, shaftLength, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, shaftLength + headLength / 2, 0]}>
        <coneGeometry args={[0.05, headLength, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
});

const Scene = memo(function Scene({
  driftAxis, driftDisplayAxis, e1, e2, e3, geomagneticAxis, geomagneticDisplayAxis, geomagneticStrength = 1, showDrift, showE1, showE2, showE3, autoRotate, rotationSpeed = 0.5, paths = {},
}: {
  driftAxis: [number, number, number]; driftDisplayAxis: [number, number, number]; e1: [number, number, number]; e2: [number, number, number]; e3: [number, number, number];
  geomagneticAxis?: [number, number, number] | null; geomagneticDisplayAxis?: [number, number, number] | null; geomagneticStrength?: number; showDrift: boolean; showE1: boolean; showE2: boolean; showE3: boolean; autoRotate: boolean; rotationSpeed?: number; paths?: { [key: string]: PathSample[] };
}) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 3]} fov={50} />
      <OrbitControls enableDamping dampingFactor={0.05} autoRotate={autoRotate} autoRotateSpeed={rotationSpeed} />
      <AxesHelper args={[1.5]} />
      <Graticules />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <directionalLight position={[-5, -5, -5]} intensity={0.5} />
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial color="#1a365d" roughness={0.3} metalness={0.1} wireframe />
      </mesh>
      <VectorArrow vector={e1} color="#ff5555" label="e1" visible={showE1} pathData={paths['e1']} />
      <VectorArrow vector={e2} color="#55ff55" label="e2" visible={showE2} pathData={paths['e2']} />
      <VectorArrow vector={e3} color="#5555ff" label="e3 (Rotation)" visible={showE3} pathData={paths['e3']} />
      <VectorArrow vector={driftDisplayAxis} color="#ffaa00" label="Drift" visible={showDrift} pathData={paths['drift']} />
      {/* Geomagnetic axis (cyan) */}
      {geomagneticDisplayAxis && (
        <VectorArrow
          vector={geomagneticDisplayAxis.map((component) => component * geomagneticStrength) as [number, number, number]}
          color="#00ffff"
          label="Geomagnetic Dipole"
          visible={true}
          pathData={paths['geomagnetic']}
        />
      )}
    </>
  );
});

export default function SphereView({
  driftAxis, e1, e2, e3, frame, showDrift = true, showE1 = true, showE2 = true, showE3 = true, autoRotate = false,
}: {
  driftAxis: [number, number, number]; e1: [number, number, number]; e2: [number, number, number]; e3: [number, number, number];
  frame: "earth" | "principal"; showDrift?: boolean; showE1?: boolean; showE2?: boolean; showE3?: boolean; autoRotate?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { data, currentTimeIndex, setCurrentTimeIndex, isPlaying, setIsPlaying, playbackSpeed, setPlaybackSpeed, driftAxisTimeSeries } = useStore();
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentTimeIndex((prev: number) => {
        const next = prev + Math.round(playbackSpeed);
        return next >= data.length ? 0 : next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying, data.length, setCurrentTimeIndex, playbackSpeed]);

  // Actually, playback speed should probably control the interval or the step.
  // Let's re-implement the effect properly in a second a bit more carefully.

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateViewportClass = () => {
      setIsMobileViewport(window.innerWidth < 768);
    };

    updateViewportClass();
    window.addEventListener("resize", updateViewportClass);
    return () => window.removeEventListener("resize", updateViewportClass);
  }, []);

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const currentSample = data[currentTimeIndex];
  const timestamp = currentSample ? currentSample.t : 'N/A';
  const displayDriftAxis = (driftAxisTimeSeries[currentTimeIndex] || currentSample?.driftAxis || driftAxis) as [number, number, number];
  const geomagneticAxis = (currentSample?.geomagnetic_axis || null) as [number, number, number] | null;
  const geomagneticStrength = currentSample?.geomagnetic_strength ?? 1;
  const geomagneticSpherical = geomagneticAxis ? toSpherical(geomagneticAxis) : null;
  const driftSpherical = toSpherical(displayDriftAxis);
  const driftLongitude = driftAxisLongitude(displayDriftAxis);
  const geomagneticLongitude = geomagneticAxis ? vectorLongitudeChart(geomagneticAxis) : null;
  const physicalBasis = useMemo(() => {
    if (!geomagneticSpherical) {
      return {
        e1: [0, 1, 0] as [number, number, number],
        e2: [1, 0, 0] as [number, number, number],
        e3: [0, 0, 1] as [number, number, number],
      };
    }

    return computePhysicalBasis(geomagneticSpherical.lat, geomagneticSpherical.lon);
  }, [geomagneticSpherical]);

  const driftDisplayAxis = rotateZ(displayDriftAxis, 90) as [number, number, number];
  const geomagneticDisplayAxis = geomagneticAxis;

  const paths = useMemo(() => {
    if (isMobileViewport) {
      return {};
    }

    const trailLength = 40;
    const start = Math.max(0, currentTimeIndex - trailLength);
    const slice = data.slice(start, currentTimeIndex + 1);
    const toTimeValue = (value: string) => new Date(value).getTime() / 86400000;
    const createPathSample = (sampleTime: string, vector: Vec3): PathSample => ({
      t: toTimeValue(sampleTime),
      vector,
    });
    
    const pathsObj: { [key: string]: PathSample[] } = {
      e1: slice.map((s) => {
        const spherical = s.geomagnetic_axis ? toSpherical(s.geomagnetic_axis as [number, number, number]) : null;
        return createPathSample(s.t, spherical ? computePhysicalBasis(spherical.lat, spherical.lon).e1 : [0, 1, 0]);
      }),
      e2: slice.map((s) => {
        const spherical = s.geomagnetic_axis ? toSpherical(s.geomagnetic_axis as [number, number, number]) : null;
        return createPathSample(s.t, spherical ? computePhysicalBasis(spherical.lat, spherical.lon).e2 : [1, 0, 0]);
      }),
      e3: slice.map((s) => createPathSample(s.t, [0, 0, 1])),
    };
    
    // Add drift axis path (yellow/orange)
    const driftPath: PathSample[] = slice.map((s, idx) => {
      const sourceIndex = start + idx;
      const driftVector = driftAxisTimeSeries[sourceIndex] || s.driftAxis;
      if (driftVector && driftVector.length === 3) {
        return createPathSample(s.t, rotateZ(driftVector as [number, number, number], 90) as [number, number, number]);
      }
      return createPathSample(s.t, [1, 0, 0]);
    });
    pathsObj['drift'] = driftPath;
    
    // Add geomagnetic axis path (cyan)
    const geomagPath: PathSample[] = slice.map((s) => {
      if (s.geomagnetic_axis && s.geomagnetic_axis.length === 3) {
        return createPathSample(s.t, s.geomagnetic_axis as [number, number, number]);
      }
      return createPathSample(s.t, [0, 0, 1]);
    });
    pathsObj['geomagnetic'] = geomagPath;
    
    return pathsObj;
  }, [data, currentTimeIndex, driftAxisTimeSeries, isMobileViewport]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-gray-900 rounded-lg overflow-hidden shadow-lg group ${
        isMobileViewport ? 'h-[560px]' : 'h-full min-h-[380px]'
      }`}
    >
      <button onClick={handleFullscreen} className="absolute top-4 right-4 z-10 p-2 bg-gray-800/50 text-white rounded hover:bg-gray-700 transition-colors opacity-0 group-hover:opacity-100" title="Toggle Fullscreen">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
      </button>
      <div className={`absolute left-4 top-4 z-10 rounded-xl border border-gray-700 bg-gray-900/80 p-4 text-xs text-gray-200 shadow-lg backdrop-blur-sm ${isMobileViewport ? 'max-w-[calc(100%-2rem)]' : ''}`}>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300">Vector Diagnostics</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-gray-400">Timestamp</span>
          <span>{timestamp}</span>
          <span className="text-gray-400">Drift Lon / Lat</span>
          <span>{driftLongitude.toFixed(1)}° / {driftSpherical.lat.toFixed(1)}°</span>
          <span className="text-gray-400">Dipole Lon / Lat</span>
          <span>{geomagneticSpherical && geomagneticLongitude !== null ? `${geomagneticLongitude.toFixed(1)}° / ${geomagneticSpherical.lat.toFixed(1)}°` : 'Unavailable'}</span>
          <span className="text-gray-400">Strength Proxy</span>
          <span>{geomagneticStrength.toFixed(2)}</span>
          <span className="text-gray-400">Source</span>
          <span>{currentSample?.geomagnetic_axis ? 'Geomagnetic series' : 'Derived fallback'}</span>
        </div>
      </div>
      <div className={`absolute z-10 rounded-xl border border-gray-700 bg-gray-900/80 p-4 backdrop-blur-sm ${isMobileViewport ? 'bottom-4 left-4 right-4 flex flex-col gap-3' : 'bottom-6 left-1/2 flex w-3/4 -translate-x-1/2 items-center gap-6'}`}>
        <div className={`flex items-center gap-4 ${isMobileViewport ? 'justify-between' : 'mr-4'}`}>
          <button onClick={() => setCurrentTimeIndex(0)} className="text-xs text-gray-400 hover:text-white transition-colors">Reset</button>
          <button onClick={() => setIsPlaying(!isPlaying)} className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-500 transition-colors shadow-lg">
            {isPlaying ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h4v16H6z"/><path d="M10 4h4v16H10z"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l14 9-14 9V3z"/></svg>}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 font-mono">Speed</span>
            <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))} className="bg-gray-800 text-white text-[10px] rounded px-1 py-0.5 border border-gray-700 focus:outline-none">
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5">5x</option>
            </select>
          </div>
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-gray-400 font-mono uppercase tracking-wider mb-1">
            <span>Timeline</span><span className="text-blue-400 font-bold">{timestamp}</span>
          </div>
          <input type="range" min="0" max={data.length - 1} value={currentTimeIndex} onChange={(e) => setCurrentTimeIndex(parseInt(e.target.value))} className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
        </div>
      </div>
      <Canvas
        dpr={isMobileViewport ? 1 : [1, 1.25]}
        frameloop={autoRotate || isPlaying ? "always" : "demand"}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        performance={{ min: 0.5 }}
        camera={{ position: [0, 0, 3], fov: 50 }}
      >
        <Scene driftAxis={displayDriftAxis} driftDisplayAxis={driftDisplayAxis} e1={physicalBasis.e1} e2={physicalBasis.e2} e3={physicalBasis.e3} geomagneticAxis={geomagneticAxis} geomagneticDisplayAxis={geomagneticDisplayAxis} geomagneticStrength={geomagneticStrength} showDrift={showDrift} showE1={showE1} showE2={showE2} showE3={showE3} autoRotate={autoRotate} paths={paths} />
      </Canvas>
    </div>
  );
}
