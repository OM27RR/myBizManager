import React, { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import DeliveryTruckModel from './DeliveryTruckModel.jsx'
import { RoadShaderMaterial } from './shaders/roadShader.js'

// Animated French Flag Highway
function AnimatedRoad({ speed, isTurbo }) {
  const roadMatRef = useRef()

  const shaderMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(RoadShaderMaterial.uniforms),
      vertexShader: RoadShaderMaterial.vertexShader,
      fragmentShader: RoadShaderMaterial.fragmentShader,
    })
  }, [])

  useFrame((_, delta) => {
    if (shaderMat) {
      shaderMat.uniforms.uTime.value += delta
      shaderMat.uniforms.uSpeed.value = isTurbo ? 3.6 : speed
      shaderMat.uniforms.uIntensity.value = isTurbo ? 1.6 : 1.0
    }
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <planeGeometry args={[14, 52, 32, 32]} />
      <primitive object={shaderMat} ref={roadMatRef} attach="material" />
    </mesh>
  )
}

// Particle Speed Streaks & Ground Sparks (French Tricolour: Bleu, Blanc, Rouge)
function ParticleStreaks({ isTurbo }) {
  const pointsRef = useRef()
  const count = 90

  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const spd = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 3.2
      pos[i * 3 + 1] = Math.random() * 0.9 + 0.05
      pos[i * 3 + 2] = -Math.random() * 10.0 - 1.5
      spd[i] = Math.random() * 10.0 + 8.0
    }
    return [pos, spd]
  }, [])

  useFrame((_, delta) => {
    if (!pointsRef.current) return
    const posAttr = pointsRef.current.geometry.attributes.position
    const mult = isTurbo ? 2.8 : 1.0

    for (let i = 0; i < count; i++) {
      posAttr.array[i * 3 + 2] -= speeds[i] * delta * mult

      if (posAttr.array[i * 3 + 2] < -18.0) {
        posAttr.array[i * 3 + 2] = -1.8
        posAttr.array[i * 3 + 0] = (Math.random() - 0.5) * 3.0
        posAttr.array[i * 3 + 1] = Math.random() * 0.8 + 0.05
      }
    }
    posAttr.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={isTurbo ? 0.16 : 0.09}
        color={isTurbo ? '#ce1126' : '#ffffff'}
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

// Camera Controller for Smooth View Transitions
function CameraController({ cameraView }) {
  useFrame(({ camera }) => {
    const targetPos = new THREE.Vector3()
    const targetLook = new THREE.Vector3(0, 1.1, 0)

    if (cameraView === 'chase') {
      targetPos.set(0, 2.2, -6.5)
      targetLook.set(0, 1.2, 8.0)
    } else if (cameraView === 'drone') {
      targetPos.set(0.2, 9.5, 3.0)
      targetLook.set(0, 0, 0)
    } else if (cameraView === 'cockpit') {
      targetPos.set(0, 1.8, 3.4)
      targetLook.set(0, 1.0, 14.0)
    } else {
      // Default: Cinematic Orbit
      targetPos.set(4.8, 3.1, 5.8)
      targetLook.set(0, 1.1, 0)
    }

    camera.position.lerp(targetPos, 0.05)
    camera.lookAt(targetLook)
  })

  return null
}

export default function DeliveryTruckScene({
  speed = 1.6,
  isTurbo = false,
  isDelivering = false,
  cameraView = 'orbit',
  isMini = false,
}) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: isMini ? [3.8, 2.2, 4.8] : [4.8, 3.1, 5.8], fov: isMini ? 46 : 40 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        {/* Deep French Navy Fog */}
        <fog attach="fog" args={['#001026', 10, 26]} />

        {/* Studio Lighting Rig */}
        <ambientLight intensity={1.2} />
        <directionalLight
          position={[6, 9, 6]}
          intensity={2.8}
          color="#ffffff"
          castShadow
        />
        {/* Crisp White Specular Top Rim Light */}
        <pointLight
          position={[0, 6, -2]}
          intensity={isTurbo ? 5.0 : 3.0}
          color="#ffffff"
          distance={14}
        />
        {/* French Blue Accent Fill Light */}
        <pointLight
          position={[-3, 2, 2]}
          intensity={2.0}
          color="#0055a4"
          distance={10}
        />
        {/* French Red Rear Accent Light */}
        <pointLight
          position={[3, 1, -4]}
          intensity={2.2}
          color="#ce1126"
          distance={8}
        />

        {/* Procedural 3D Truck Model in French Colorway */}
        <DeliveryTruckModel
          speed={speed}
          isTurbo={isTurbo}
          isDelivering={isDelivering}
        />

        {/* French Flag Highway Shader */}
        <AnimatedRoad speed={speed} isTurbo={isTurbo} />

        {/* Speed Sparks & Light Particles */}
        <ParticleStreaks isTurbo={isTurbo} />

        {/* Camera Transition Controller */}
        <CameraController cameraView={cameraView} />

        {/* Free Orbit Controls */}
        {cameraView === 'orbit' && (
          <OrbitControls
            enablePan={false}
            enableZoom={!isMini}
            minDistance={3.2}
            maxDistance={11.0}
            maxPolarAngle={Math.PI / 2 - 0.04}
            dampingFactor={0.06}
            rotateSpeed={0.7}
          />
        )}
      </Canvas>
    </div>
  )
}
