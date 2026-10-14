/** Deliberately plain: a key light, a cool fill, and ambient/hemisphere fill light. No
 * HDRI environment map or contact-shadow helper (both fetch from a CDN and add prop-shape
 * risk this build doesn't need) - see docs/ARCHITECTURE.md for why. */
export default function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#4a4a4a', '#050505', 0.45]} />
      <directionalLight
        position={[26, 42, 16]}
        intensity={1.3}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-46}
        shadow-camera-right={46}
        shadow-camera-top={46}
        shadow-camera-bottom={-46}
        shadow-camera-far={150}
      />
      <directionalLight position={[-22, 18, -20]} intensity={0.25} color="#8fb0ff" />
    </>
  );
}
