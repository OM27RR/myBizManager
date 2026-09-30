import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// French National Flag Colorway Delivery Truck (Bleu #002654, Blanc #FFFFFF, Rouge #CE1126)
export default function DeliveryTruckModel({ speed = 1.6, isTurbo = false, isDelivering = false }) {
  const truckGroup = useRef()
  const frontLeftWheel = useRef()
  const frontRightWheel = useRef()
  const rearLeftWheel1 = useRef()
  const rearRightWheel1 = useRef()
  const rearLeftWheel2 = useRef()
  const rearRightWheel2 = useRef()
  const cargoBox1 = useRef()
  const cargoBox2 = useRef()
  const cargoBox3 = useRef()

  // French Flag Materials
  const frenchBlueBody = new THREE.MeshStandardMaterial({
    color: '#002654', // Official French Navy Blue
    roughness: 0.28,
    metalness: 0.75,
  })

  const frenchRedTrim = new THREE.MeshStandardMaterial({
    color: '#ce1126', // Official French Carmine Red
    emissive: isTurbo ? '#e61c34' : '#6b0511',
    emissiveIntensity: isTurbo ? 1.0 : 0.35,
    roughness: 0.3,
    metalness: 0.65,
  })

  const pureWhiteMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff', // Official French White
    roughness: 0.2,
    metalness: 0.85,
  })

  const darkGlassMaterial = new THREE.MeshPhysicalMaterial({
    color: '#001026',
    transparent: true,
    opacity: 0.88,
    roughness: 0.08,
    metalness: 0.9,
    reflectivity: 0.9,
  })

  const tireMaterial = new THREE.MeshStandardMaterial({
    color: '#080c14',
    roughness: 0.85,
    metalness: 0.1,
  })

  const pureWhiteLightbar = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#ffffff',
    emissiveIntensity: isTurbo ? 3.5 : 2.2,
  })

  const tailLampRed = new THREE.MeshStandardMaterial({
    color: '#ce1126',
    emissive: '#ce1126',
    emissiveIntensity: 2.5,
  })

  useFrame((state, delta) => {
    const time = state.clock.getElapsedTime()
    const currentSpeed = speed * (isTurbo ? 2.6 : 1.0)

    // Wheel rotation based on velocity
    const wheelRotDelta = currentSpeed * delta * 12
    if (frontLeftWheel.current) frontLeftWheel.current.rotation.x += wheelRotDelta
    if (frontRightWheel.current) frontRightWheel.current.rotation.x += wheelRotDelta
    if (rearLeftWheel1.current) rearLeftWheel1.current.rotation.x += wheelRotDelta
    if (rearRightWheel1.current) rearRightWheel1.current.rotation.x += wheelRotDelta
    if (rearLeftWheel2.current) rearLeftWheel2.current.rotation.x += wheelRotDelta
    if (rearRightWheel2.current) rearRightWheel2.current.rotation.x += wheelRotDelta

    // Chassis suspension vibration and engine hum
    if (truckGroup.current) {
      truckGroup.current.position.y = Math.sin(time * 16 * (isTurbo ? 1.5 : 1.0)) * 0.02
      truckGroup.current.rotation.z = Math.sin(time * 7) * 0.006
      truckGroup.current.rotation.x = Math.sin(time * 11) * 0.005

      // Delivery acceleration surge
      if (isDelivering) {
        truckGroup.current.position.z = Math.sin(time * 4) * 0.22
      }
    }

    // Floating 3D Holographic Cargo Crates Hover Animation
    if (cargoBox1.current) {
      cargoBox1.current.position.y = 2.45 + Math.sin(time * 3.2 + 0) * 0.12
      cargoBox1.current.rotation.y += delta * 0.7
    }
    if (cargoBox2.current) {
      cargoBox2.current.position.y = 2.35 + Math.sin(time * 3.2 + 1.6) * 0.12
      cargoBox2.current.rotation.y -= delta * 0.65
    }
    if (cargoBox3.current) {
      cargoBox3.current.position.y = 2.5 + Math.sin(time * 3.2 + 3.1) * 0.12
      cargoBox3.current.rotation.y += delta * 0.8
    }
  })

  // Wheel Subcomponent with French Colors
  const AeroWheel = ({ position, wheelRef }) => (
    <group position={position} ref={wheelRef}>
      {/* Outer Tire */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.42, 0.42, 0.32, 28]} />
        <primitive object={tireMaterial} attach="material" />
      </mesh>
      {/* Stark White Aero-Disc Rim */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.3, 0.3, 0.33, 20]} />
        <primitive object={pureWhiteMaterial} attach="material" />
      </mesh>
      {/* French Red Center Hub */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.1, 0.35, 12]} />
        <primitive object={frenchRedTrim} attach="material" />
      </mesh>
      {/* Outer White Rim Ring */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.31, 0.015, 8, 24]} />
        <primitive object={pureWhiteLightbar} attach="material" />
      </mesh>
    </group>
  )

  return (
    <group position={[0, 0.42, 0]}>
      {/* SUSPENSION RIG & MAIN TRUCK GEOMETRY */}
      <group ref={truckGroup}>
        {/* ============ 1. CABIN SECTION (French Blue + Red + White) ============ */}
        {/* Lower Cab Body (French Navy Blue #002654) */}
        <mesh position={[0, 0.58, 2.15]}>
          <boxGeometry args={[1.72, 0.82, 1.65]} />
          <primitive object={frenchBlueBody} attach="material" />
        </mesh>

        {/* Upper Cockpit (French Navy Blue) */}
        <mesh position={[0, 1.28, 1.95]}>
          <boxGeometry args={[1.68, 0.72, 1.35]} />
          <primitive object={frenchBlueBody} attach="material" />
        </mesh>

        {/* Aerodynamic Roof Deflector (French Red #CE1126) */}
        <mesh position={[0, 1.78, 1.85]} rotation={[-0.22, 0, 0]}>
          <boxGeometry args={[1.65, 0.3, 1.15]} />
          <primitive object={frenchRedTrim} attach="material" />
        </mesh>
        <mesh position={[0, 1.92, 1.85]} rotation={[-0.22, 0, 0]}>
          <boxGeometry args={[1.66, 0.03, 1.16]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>

        {/* Tinted Panoramic Windshield */}
        <mesh position={[0, 1.32, 2.65]} rotation={[0.26, 0, 0]}>
          <boxGeometry args={[1.56, 0.58, 0.05]} />
          <primitive object={darkGlassMaterial} attach="material" />
        </mesh>

        {/* Continuous Horizontal White LED Lightbar */}
        <mesh position={[0, 0.62, 2.99]}>
          <boxGeometry args={[1.65, 0.1, 0.04]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>

        {/* Dual Matrix High-Beams */}
        <mesh position={[-0.65, 0.42, 2.98]}>
          <boxGeometry args={[0.26, 0.14, 0.04]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>
        <mesh position={[0.65, 0.42, 2.98]}>
          <boxGeometry args={[0.26, 0.14, 0.04]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>

        {/* High-Intensity Forward Spotlights */}
        <spotLight
          position={[-0.65, 0.5, 3.1]}
          target-position={[-0.65, -0.2, 12.0]}
          color="#ffffff"
          intensity={isTurbo ? 6.0 : 3.8}
          angle={0.5}
          penumbra={0.5}
          distance={18}
        />
        <spotLight
          position={[0.65, 0.5, 3.1]}
          target-position={[0.65, -0.2, 12.0]}
          color="#ffffff"
          intensity={isTurbo ? 6.0 : 3.8}
          angle={0.5}
          penumbra={0.5}
          distance={18}
        />

        {/* Front Lower Bumper (French Red Diffuser) */}
        <mesh position={[0, 0.2, 2.95]}>
          <boxGeometry args={[1.76, 0.18, 0.18]} />
          <primitive object={frenchRedTrim} attach="material" />
        </mesh>

        {/* Digital Camera Wing Mirrors */}
        <mesh position={[-0.98, 1.25, 2.25]}>
          <boxGeometry args={[0.18, 0.06, 0.14]} />
          <primitive object={frenchRedTrim} attach="material" />
        </mesh>
        <mesh position={[0.98, 1.25, 2.25]}>
          <boxGeometry args={[0.18, 0.06, 0.14]} />
          <primitive object={frenchRedTrim} attach="material" />
        </mesh>

        {/* ============ 2. CARGO TRAILER (French Blue + Red Stripes + White) ============ */}
        {/* Main Cargo Container (French Navy Blue #002654) */}
        <mesh position={[0, 1.38, -0.92]}>
          <boxGeometry args={[1.78, 1.76, 4.3]} />
          <primitive object={frenchBlueBody} attach="material" />
        </mesh>

        {/* Top & Bottom Accent Rails (French Red #CE1126) */}
        <mesh position={[0, 2.28, -0.92]}>
          <boxGeometry args={[1.81, 0.06, 4.32]} />
          <primitive object={frenchRedTrim} attach="material" />
        </mesh>
        <mesh position={[0, 0.52, -0.92]}>
          <boxGeometry args={[1.81, 0.06, 4.32]} />
          <primitive object={frenchRedTrim} attach="material" />
        </mesh>

        {/* Side White Laser Strips (#FFFFFF) */}
        <mesh position={[-0.91, 1.38, -0.92]}>
          <boxGeometry args={[0.02, 0.08, 4.0]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>
        <mesh position={[0.91, 1.38, -0.92]}>
          <boxGeometry args={[0.02, 0.08, 4.0]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>

        {/* Side Typography Placards */}
        <mesh position={[-0.905, 1.8, -0.92]}>
          <planeGeometry args={[2.8, 0.35]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>
        <mesh position={[0.905, 1.8, -0.92]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[2.8, 0.35]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>

        {/* Rear Hydraulic Cargo Doors */}
        <mesh position={[0, 1.38, -3.09]}>
          <boxGeometry args={[1.72, 1.68, 0.05]} />
          <primitive object={frenchBlueBody} attach="material" />
        </mesh>

        {/* Rear Door Locking Vertical Ribs (White) */}
        <mesh position={[-0.38, 1.38, -3.12]}>
          <cylinderGeometry args={[0.02, 0.02, 1.55, 10]} />
          <primitive object={pureWhiteMaterial} attach="material" />
        </mesh>
        <mesh position={[0.38, 1.38, -3.12]}>
          <cylinderGeometry args={[0.02, 0.02, 1.55, 10]} />
          <primitive object={pureWhiteMaterial} attach="material" />
        </mesh>

        {/* Continuous Rear Red LED Tail Strip */}
        <mesh position={[0, 0.6, -3.11]}>
          <boxGeometry args={[1.65, 0.08, 0.03]} />
          <primitive object={tailLampRed} attach="material" />
        </mesh>

        {/* Chassis Frame */}
        <mesh position={[0, 0.35, 0.3]}>
          <boxGeometry args={[1.25, 0.2, 6.3]} />
          <primitive object={frenchBlueBody} attach="material" />
        </mesh>
      </group>

      {/* ============ 3. WHEELS ============ */}
      <AeroWheel position={[-0.93, 0, 2.15]} wheelRef={frontLeftWheel} />
      <AeroWheel position={[0.93, 0, 2.15]} wheelRef={frontRightWheel} />
      <AeroWheel position={[-0.93, 0, -1.8]} wheelRef={rearLeftWheel1} />
      <AeroWheel position={[0.93, 0, -1.8]} wheelRef={rearRightWheel1} />
      <AeroWheel position={[-0.93, 0, -2.75]} wheelRef={rearLeftWheel2} />
      <AeroWheel position={[0.93, 0, -2.75]} wheelRef={rearRightWheel2} />

      {/* ============ 4. FLOATING TRICOLOUR CARGO CRATES ============ */}
      {/* Cargo Crate 1: French Blue (#002654) */}
      <group position={[-1.65, 2.4, 0.7]} ref={cargoBox1}>
        <mesh>
          <boxGeometry args={[0.65, 0.55, 0.65]} />
          <primitive object={frenchBlueBody} attach="material" />
        </mesh>
        <mesh position={[0, 0, 0.33]}>
          <planeGeometry args={[0.5, 0.4]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(0.66, 0.56, 0.66)]} />
          <lineBasicMaterial color="#ffffff" linewidth={1.5} />
        </lineSegments>
      </group>

      {/* Cargo Crate 2: French Red (#CE1126) */}
      <group position={[1.7, 2.3, -0.4]} ref={cargoBox2}>
        <mesh>
          <boxGeometry args={[0.7, 0.6, 0.7]} />
          <primitive object={frenchRedTrim} attach="material" />
        </mesh>
        <mesh position={[0, 0, 0.36]}>
          <planeGeometry args={[0.55, 0.45]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(0.71, 0.61, 0.71)]} />
          <lineBasicMaterial color="#ffffff" linewidth={1.5} />
        </lineSegments>
      </group>

      {/* Cargo Crate 3: French White (#FFFFFF) */}
      <group position={[0, 2.8, -1.5]} ref={cargoBox3}>
        <mesh>
          <boxGeometry args={[0.6, 0.5, 0.6]} />
          <primitive object={pureWhiteMaterial} attach="material" />
        </mesh>
        <mesh position={[0, 0, 0.31]}>
          <planeGeometry args={[0.45, 0.35]} />
          <primitive object={pureWhiteLightbar} attach="material" />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(0.61, 0.51, 0.61)]} />
          <lineBasicMaterial color="#002654" linewidth={1.5} />
        </lineSegments>
      </group>
    </group>
  )
}
