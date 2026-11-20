"use strict";

// Body coordinates: X forward, Y right, Z down. The initial camera looks along -Z.
(function initializeImuViewer() {
  const canvas = document.querySelector("#imuCanvas");
  const viewport = canvas?.parentElement;
  const status = document.querySelector("#imuModelStatus");
  if (!canvas || !viewport || !window.THREE || !THREE.STLLoader) {
    if (status) status.textContent = "三维渲染库加载失败";
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (error) {
    console.warn("IMU WebGL viewer unavailable", error);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xffffff, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.up.set(0, 1, 0);
  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(3, -2, 5);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(-4, 3, -2);
  scene.add(ambient, keyLight, fillLight);

  const body = new THREE.Group();
  scene.add(body);
  function labelTexture(text, color = "#174f57") {
    const surface = document.createElement("canvas");
    surface.width = 256;
    surface.height = 96;
    const context = surface.getContext("2d");
    context.clearRect(0, 0, 256, 96);
    context.fillStyle = color;
    context.font = "bold 64px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 128, 48);
    const texture = new THREE.CanvasTexture(surface);
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  }

  function addAxis(direction, color, label, length) {
    const vector = new THREE.Vector3(...direction);
    const material = new THREE.MeshPhongMaterial({ color, shininess: 45 });
    const headLength = 0.18;
    const shaftLength = length - headLength;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, shaftLength, 12), material);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector);
    shaft.position.copy(vector).multiplyScalar(shaftLength / 2);
    body.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, headLength, 16), material);
    head.quaternion.copy(shaft.quaternion);
    head.position.copy(vector).multiplyScalar(shaftLength + headLength / 2);
    body.add(head);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, `#${color.toString(16).padStart(6, "0")}`), transparent: true, depthTest: false }));
    sprite.position.copy(vector.multiplyScalar(length + 0.16));
    sprite.scale.set(0.46, 0.2, 1);
    body.add(sprite);
  }
  addAxis([1, 0, 0], 0xff7178, "X", 1.28);
  addAxis([0, 1, 0], 0x4be2aa, "Y", 1.28);
  addAxis([0, 0, 1], 0x75aaff, "Z", 0.7);

  new THREE.STLLoader().load("models/IMU.STL", (geometry) => {
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const size = bounds.getSize(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largest) || largest <= 0) {
      status.textContent = "IMU 模型尺寸无效";
      return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(1.15 / largest, 1.15 / largest, 1.15 / largest);
    geometry.computeVertexNormals();
    body.add(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
      color: 0xb5bcc4, specular: 0x68717b, shininess: 38, side: THREE.DoubleSide,
    })));
    status.hidden = true;
    requestRender();
  }, undefined, (error) => {
    status.textContent = "IMU.STL 加载失败";
    console.error("IMU STL load failed", error);
  });

  const target = new THREE.Quaternion();
  let frame = 0;
  let lastTime = 0;
  camera.position.set(0, 0, 4.5);

  function updateCamera() {
    camera.lookAt(0, 0, 0);
    requestRender();
  }

  function rotateCamera(deltaX, deltaY) {
    const yaw = new THREE.Quaternion().setFromAxisAngle(camera.up.clone().normalize(), -deltaX * 0.008);
    camera.position.applyQuaternion(yaw);
    camera.lookAt(0, 0, 0);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const pitch = new THREE.Quaternion().setFromAxisAngle(right, -deltaY * 0.008);
    camera.position.applyQuaternion(pitch);
    camera.up.applyQuaternion(pitch).normalize();
    updateCamera();
  }

  function render(time) {
    frame = 0;
    const delta = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0.016;
    lastTime = time;
    const angle = body.quaternion.angleTo(target);
    if (angle > 0.0001) {
      body.quaternion.slerp(target, Math.min(1, delta * 12));
      if (body.quaternion.angleTo(target) > 0.0001) requestRender();
    }
    renderer.render(scene, camera);
  }

  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function resize() {
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }

  let pointer = null;
  canvas.addEventListener("pointerdown", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointer) return;
    rotateCamera(event.clientX - pointer.x, event.clientY - pointer.y);
    pointer = { x: event.clientX, y: event.clientY };
    updateCamera();
  });
  canvas.addEventListener("pointerup", () => { pointer = null; });
  canvas.addEventListener("pointercancel", () => { pointer = null; });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    camera.position.setLength(Math.max(2.4, Math.min(8, camera.position.length() * Math.exp(event.deltaY * 0.001))));
    updateCamera();
  }, { passive: false });

  window.imuViewer = {
    setAttitude(roll, pitch, yaw) {
      const radians = Math.PI / 180;
      target.setFromEuler(new THREE.Euler(roll * radians, pitch * radians, yaw * radians, "ZYX"));
      requestRender();
    },
  };
  new ResizeObserver(resize).observe(viewport);
  updateCamera();
  resize();
})();
