"use strict";

(function initializeServoViewer() {
  const canvas = document.querySelector("#servoCanvas");
  const viewport = canvas?.parentElement;
  const status = document.querySelector("#servoModelStatus");
  if (!canvas || !viewport || !window.THREE || !THREE.STLLoader) {
    if (status) status.textContent = "三维渲染库加载失败";
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (error) {
    status.textContent = "当前浏览器无法创建三维视图";
    console.error("Servo WebGL viewer unavailable", error);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xffffff, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  // Show the fish horizontally: round nose left, tail right, near fin below.
  camera.up.set(1, 0, -0.12);
  camera.position.set(-3, 2.2, 0.5);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(3, -4, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xb7d8e4, 0.45);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  const assembly = new THREE.Group();
  scene.add(assembly);
  // Both STL files now use assembly coordinates. The fin shaft runs along X.
  const finPivot = new THREE.Group();
  const hinge = new THREE.Vector3(0, -2.5, -35.8);
  finPivot.position.copy(hinge);
  assembly.add(finPivot);

  let frame = 0;
  let lastTime = 0;
  let currentAngle = 0;
  let targetAngle = 0;

  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function render(time) {
    frame = 0;
    const delta = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0.016;
    lastTime = time;
    if (Math.abs(targetAngle - currentAngle) > 0.0001) {
      currentAngle += (targetAngle - currentAngle) * Math.min(1, delta * 12);
      finPivot.rotation.x = currentAngle;
      if (Math.abs(targetAngle - currentAngle) > 0.0001) requestRender();
    }
    renderer.render(scene, camera);
  }

  function resize() {
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }

  const loader = new THREE.STLLoader();
  function loadModel(path) {
    return new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));
  }
  Promise.all([loadModel("models/Body.STL"), loadModel("models/Fin.STL")]).then(([bodyGeometry, finGeometry]) => {
    bodyGeometry.computeBoundingBox();
    finGeometry.computeBoundingBox();
    const bounds = bodyGeometry.boundingBox.clone().union(finGeometry.boundingBox);
    const size = bounds.getSize(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largest) || largest <= 0) throw new Error("Invalid model bounds");

    // Apply one shared scene transform; neither STL needs a part offset.
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 2.6 / largest;
    assembly.scale.setScalar(scale);
    assembly.position.copy(center).multiplyScalar(-scale);
    assembly.add(new THREE.Mesh(bodyGeometry, new THREE.MeshPhongMaterial({
      color: 0xb6c0c8, specular: 0x6f8490, shininess: 35, side: THREE.DoubleSide,
    })));
    const fin = new THREE.Mesh(finGeometry, new THREE.MeshPhongMaterial({
      color: 0xe6ae67, specular: 0x9d6b36, shininess: 42, side: THREE.DoubleSide,
    }));
    fin.position.copy(hinge).negate();
    finPivot.add(fin);
    status.hidden = true;
    requestRender();
  }).catch((error) => {
    status.textContent = "Body.STL 或 Fin.STL 加载失败";
    console.error("Fish STL load failed", error);
  });

  function rotateCamera(deltaX, deltaY) {
    const yaw = new THREE.Quaternion().setFromAxisAngle(camera.up.clone().normalize(), -deltaX * 0.008);
    camera.position.applyQuaternion(yaw);
    camera.lookAt(0, 0, 0);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const pitch = new THREE.Quaternion().setFromAxisAngle(right, -deltaY * 0.008);
    camera.position.applyQuaternion(pitch);
    camera.up.applyQuaternion(pitch).normalize();
    camera.lookAt(0, 0, 0);
    requestRender();
  }

  let pointer = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    rotateCamera(event.clientX - pointer.x, event.clientY - pointer.y);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (pointer?.id === event.pointerId) pointer = null;
  });
  canvas.addEventListener("pointercancel", () => { pointer = null; });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    camera.position.setLength(Math.max(3.4, Math.min(11, camera.position.length() * Math.exp(event.deltaY * 0.001))));
    camera.lookAt(0, 0, 0);
    requestRender();
  }, { passive: false });

  window.servoViewer = {
    setAngle(degrees) {
      if (!Number.isFinite(degrees)) return;
      targetAngle = degrees * Math.PI / 180;
      requestRender();
    },
  };
  new ResizeObserver(resize).observe(viewport);
  resize();
})();
