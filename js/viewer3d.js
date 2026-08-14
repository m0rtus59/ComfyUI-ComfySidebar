import { is3DFormat } from "./utils.js";
import { SidebarOverlay } from "./overlay.js";

let cachedThreeLibs = null;

async function getThreeLibs() {
    if (cachedThreeLibs) return cachedThreeLibs;
    if (window.THREE && window.THREE.GLTFLoader && window.THREE.OrbitControls) {
        cachedThreeLibs = window.THREE;
        return cachedThreeLibs;
    }
    try {
        const [three, controls, gltf, obj, stl, ply] = await Promise.all([
            import("https://esm.sh/three@0.170.0"),
            import("https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js"),
            import("https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js"),
            import("https://esm.sh/three@0.170.0/examples/jsm/loaders/OBJLoader.js"),
            import("https://esm.sh/three@0.170.0/examples/jsm/loaders/STLLoader.js"),
            import("https://esm.sh/three@0.170.0/examples/jsm/loaders/PLYLoader.js")
        ]);

        cachedThreeLibs = {
            ...three,
            OrbitControls: controls.OrbitControls,
            GLTFLoader: gltf.GLTFLoader,
            OBJLoader: obj.OBJLoader,
            STLLoader: stl.STLLoader,
            PLYLoader: ply.PLYLoader
        };
        return cachedThreeLibs;
    } catch (err) {
        console.error("Comfy Sidebar: Failed to load Three.js libraries", err);
        return null;
    }
}

export function create3DViewer(baseSrc, onSwitchMedia = () => {}, onDestroy = () => {}) {
    const overlay = new SidebarOverlay({
        className: "comfy-sidebar-3d-overlay-root",
        onDestroy
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
        position: "absolute", top: "16px", left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: "16px", zIndex: "30", color: "#aaa", fontSize: "12px",
        fontFamily: "monospace", pointerEvents: "none", background: "rgba(10,10,10,0.75)",
        padding: "6px 14px", borderRadius: "6px", backdropFilter: "blur(4px)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)", maxWidth: "85%", textAlign: "center"
    });
    const titleText = document.createElement("span");
    titleText.textContent = baseSrc.split("/").pop().split("?")[0] || "3D Model";
    header.appendChild(titleText);
    overlay.container.appendChild(header);

    const canvasContainer = document.createElement("div");
    Object.assign(canvasContainer.style, {
        width: "100%", height: "100%", position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center"
    });
    overlay.container.appendChild(canvasContainer);

    const loadingSpinner = document.createElement("div");
    Object.assign(loadingSpinner.style, {
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        color: "#60a5fa", fontSize: "14px", fontFamily: "sans-serif", zIndex: "20",
        background: "rgba(0,0,0,0.8)", padding: "10px 18px", borderRadius: "8px",
        display: "flex", alignItems: "center", gap: "10px"
    });
    loadingSpinner.innerHTML = `<span class="pi pi-spin pi-spinner" style="font-size: 18px;"></span> Loading 3D Asset...`;
    overlay.container.appendChild(loadingSpinner);

    const settingsPanel = document.createElement("div");
    Object.assign(settingsPanel.style, {
        position: "absolute", top: "60px", right: "20px", width: "230px",
        background: "rgba(18, 18, 24, 0.9)", backdropFilter: "blur(8px)",
        border: "1px solid rgba(255, 255, 255, 0.12)", borderRadius: "8px",
        padding: "14px", zIndex: "35", color: "#e2e8f0", fontSize: "11px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)", display: "none", flexDirection: "column", gap: "12px"
    });

    const createFormGroup = (label, inputEl) => {
        const row = document.createElement("div");
        Object.assign(row.style, { display: "flex", flexDirection: "column", gap: "4px" });
        const lbl = document.createElement("label");
        lbl.textContent = label;
        Object.assign(lbl.style, { color: "#94a3b8", fontSize: "10px", textTransform: "uppercase", fontWeight: "bold" });
        row.append(lbl, inputEl);
        return row;
    };

    const createSelect = (options, value, onChange) => {
        const sel = document.createElement("select");
        Object.assign(sel.style, {
            background: "#252530", color: "#eee", border: "1px solid #444",
            borderRadius: "4px", padding: "4px 6px", fontSize: "11px", outline: "none"
        });
        options.forEach(opt => {
            const o = document.createElement("option");
            o.value = opt.value;
            o.textContent = opt.label;
            if (opt.value === value) o.selected = true;
            sel.appendChild(o);
        });
        sel.onchange = (e) => onChange(e.target.value);
        return sel;
    };

    const toolbar = document.createElement("div");
    Object.assign(toolbar.style, {
        position: "absolute", bottom: "20px", left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: "8px", zIndex: "30", background: "rgba(20,20,25,0.85)",
        padding: "6px 12px", borderRadius: "8px", backdropFilter: "blur(6px)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.1)",
        alignItems: "center"
    });

    const createToolbarBtn = (iconClass, label, activeDefault, onClick) => {
        const btn = document.createElement("button");
        let active = activeDefault;
        btn.className = "comfy-sidebar-3d-tool-btn";
        Object.assign(btn.style, {
            background: active ? "#3b82f6" : "transparent", color: active ? "#fff" : "#aaa",
            border: "1px solid " + (active ? "#3b82f6" : "#444"), borderRadius: "4px",
            padding: "4px 10px", fontSize: "11px", cursor: "pointer", display: "flex",
            alignItems: "center", gap: "6px", transition: "all 0.15s ease"
        });
        btn.innerHTML = `<i class="${iconClass}"></i><span>${label}</span>`;
        btn.onclick = (e) => {
            e.stopPropagation();
            active = !active;
            btn.style.background = active ? "#3b82f6" : "transparent";
            btn.style.color = active ? "#fff" : "#aaa";
            btn.style.borderColor = active ? "#3b82f6" : "#444";
            onClick(active);
        };
        return btn;
    };

    let renderer, scene, camera, cameraPersp, cameraOrtho, controls, currentModel, gridHelper, animId;
    let ambientLight, dirLight1, dirLight2;
    let autoRotate = false, showWireframe = false, currentMaterialMode = "original", currentUpDirection = "y-up";
    let lightMultiplier = 1.0;
    let THREE = null;

    const applyMaterialMode = () => {
        if (!currentModel || !THREE) return;
        currentModel.traverse((child) => {
            if (child.isMesh) {
                if (currentMaterialMode === "clay") {
                    child.material = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.6, metalness: 0.1 });
                } else if (currentMaterialMode === "normal") {
                    child.material = new THREE.MeshNormalMaterial();
                } else {
                    child.material = child._originalMaterial || child.material;
                }

                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.wireframe = showWireframe);
                } else if (child.material) {
                    child.material.wireframe = showWireframe;
                }
            }
        });
    };

    const applyUpDirection = () => {
        if (!currentModel || !THREE) return;
        if (currentUpDirection === "z-up") {
            currentModel.rotation.x = -Math.PI / 2;
            currentModel.rotation.y = 0;
            currentModel.rotation.z = 0;
        } else if (currentUpDirection === "z-down") {
            currentModel.rotation.x = Math.PI / 2;
            currentModel.rotation.y = 0;
            currentModel.rotation.z = 0;
        } else {
            currentModel.rotation.x = 0;
            currentModel.rotation.y = 0;
            currentModel.rotation.z = 0;
        }
        if (controls && camera) {
            fitCameraToObject(camera, currentModel, controls, THREE);
            if (gridHelper) gridHelper.position.y = new THREE.Box3().setFromObject(currentModel).min.y;
        }
    };

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportModel = async (format) => {
        if (!currentModel) return;
        const baseName = (titleText.textContent || "model").replace(/\.[^/.]+$/, "");

        try {
            loadingSpinner.style.display = "flex";
            loadingSpinner.innerHTML = `<span class="pi pi-spin pi-spinner"></span> Exporting ${format}...`;

            if (format === "OBJ") {
                const { OBJExporter } = await import("https://esm.sh/three@0.170.0/examples/jsm/exporters/OBJExporter.js");
                const exporter = new OBJExporter();
                const result = exporter.parse(currentModel);
                const blob = new Blob([result], { type: "text/plain" });
                downloadBlob(blob, `${baseName}.obj`);
            } else if (format === "GLB") {
                const { GLTFExporter } = await import("https://esm.sh/three@0.170.0/examples/jsm/exporters/GLTFExporter.js");
                const exporter = new GLTFExporter();
                exporter.parse(currentModel, (gltf) => {
                    const blob = new Blob([gltf], { type: "application/octet-stream" });
                    downloadBlob(blob, `${baseName}.glb`);
                }, (err) => { console.error(err); }, { binary: true });
            } else if (format === "STL") {
                const { STLExporter } = await import("https://esm.sh/three@0.170.0/examples/jsm/exporters/STLExporter.js");
                const exporter = new STLExporter();
                const result = exporter.parse(currentModel, { binary: true });
                const blob = new Blob([result], { type: "application/octet-stream" });
                downloadBlob(blob, `${baseName}.stl`);
            }
        } catch (err) {
            console.error("Comfy Sidebar: Export failed", err);
        } finally {
            loadingSpinner.style.display = "none";
        }
    };

    const cleanup3D = () => {
        if (animId) cancelAnimationFrame(animId);
        if (controls) controls.dispose();
        if (currentModel && scene) scene.remove(currentModel);
        if (renderer) {
            renderer.dispose();
            renderer.domElement.remove();
        }
    };

    overlay.addCleanup(cleanup3D);

    const initSceneAndLoad = async (srcUrl) => {
        loadingSpinner.style.display = "flex";
        loadingSpinner.innerHTML = `<span class="pi pi-spin pi-spinner" style="font-size: 18px;"></span> Loading 3D Asset...`;
        titleText.textContent = srcUrl.split("/").pop().split("?")[0] || "3D Model";

        THREE = await getThreeLibs();
        if (!THREE) {
            loadingSpinner.textContent = "Failed to load 3D engine.";
            return;
        }

        if (!renderer) {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x0e0e12);

            const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
            cameraPersp = new THREE.PerspectiveCamera(45, aspect, 0.01, 1000);
            cameraPersp.position.set(0, 1.5, 3.5);

            const d = 2;
            cameraOrtho = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.01, 1000);
            cameraOrtho.position.set(0, 1.5, 3.5);

            camera = cameraPersp;

            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.0;
            canvasContainer.appendChild(renderer.domElement);

            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;

            ambientLight = new THREE.AmbientLight(0xffffff, 1.2 * lightMultiplier);
            scene.add(ambientLight);

            dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8 * lightMultiplier);
            dirLight1.position.set(5, 10, 7);
            scene.add(dirLight1);

            dirLight2 = new THREE.DirectionalLight(0x90b0ff, 0.8 * lightMultiplier);
            dirLight2.position.set(-5, -5, -5);
            scene.add(dirLight2);

            gridHelper = new THREE.GridHelper(10, 20, 0x3b82f6, 0x22222a);
            gridHelper.position.y = 0;
            scene.add(gridHelper);

            const bgColorInput = document.createElement("input");
            bgColorInput.type = "color";
            bgColorInput.value = "#0e0e12";
            Object.assign(bgColorInput.style, { width: "100%", height: "26px", borderRadius: "4px", border: "none", cursor: "pointer" });
            bgColorInput.oninput = (e) => { scene.background.set(e.target.value); };

            const upDirSelect = createSelect([
                { value: "y-up", label: "Original (Y-Up)" },
                { value: "z-up", label: "Z-Up (+90°)" },
                { value: "z-down", label: "Inverted (-90°)" }
            ], currentUpDirection, (val) => {
                currentUpDirection = val;
                applyUpDirection();
            });

            const matModeSelect = createSelect([
                { value: "original", label: "Original / Textured" },
                { value: "clay", label: "Clay / Studio Matte" },
                { value: "normal", label: "Normals" }
            ], currentMaterialMode, (val) => {
                currentMaterialMode = val;
                applyMaterialMode();
            });

            const camTypeSelect = createSelect([
                { value: "perspective", label: "Perspective" },
                { value: "orthographic", label: "Orthographic" }
            ], "perspective", (val) => {
                const prevPos = camera.position.clone();
                const prevTarget = controls.target.clone();

                if (val === "orthographic") camera = cameraOrtho;
                else camera = cameraPersp;

                camera.position.copy(prevPos);
                controls.object = camera;
                controls.target.copy(prevTarget);
                controls.update();
            });

            const fovContainer = document.createElement("div");
            Object.assign(fovContainer.style, { display: "flex", alignItems: "center", gap: "8px" });
            const fovSlider = document.createElement("input");
            Object.assign(fovSlider, { type: "range", min: "15", max: "120", value: "45" });
            fovSlider.style.flex = "1";
            const fovVal = document.createElement("span");
            fovVal.textContent = "45°";
            fovSlider.oninput = (e) => {
                const v = Number(e.target.value);
                fovVal.textContent = `${v}°`;
                cameraPersp.fov = v;
                cameraPersp.updateProjectionMatrix();
            };
            fovContainer.append(fovSlider, fovVal);

            const lightContainer = document.createElement("div");
            Object.assign(lightContainer.style, { display: "flex", alignItems: "center", gap: "8px" });
            const lightSlider = document.createElement("input");
            Object.assign(lightSlider, { type: "range", min: "0.1", max: "3.0", step: "0.1", value: "1.0" });
            lightSlider.style.flex = "1";
            const lightVal = document.createElement("span");
            lightVal.textContent = "1.0x";
            lightSlider.oninput = (e) => {
                lightMultiplier = Number(e.target.value);
                lightVal.textContent = `${lightMultiplier.toFixed(1)}x`;
                ambientLight.intensity = 1.2 * lightMultiplier;
                dirLight1.intensity = 1.8 * lightMultiplier;
                dirLight2.intensity = 0.8 * lightMultiplier;
            };
            lightContainer.append(lightSlider, lightVal);

            settingsPanel.append(
                createFormGroup("Background Color", bgColorInput),
                createFormGroup("Up Direction", upDirSelect),
                createFormGroup("Material Mode", matModeSelect),
                createFormGroup("Camera Type", camTypeSelect),
                createFormGroup("FOV", fovContainer),
                createFormGroup("Light Intensity", lightContainer)
            );
            overlay.container.appendChild(settingsPanel);

            const btnGrid = createToolbarBtn("pi pi-table", "Grid", true, (v) => { gridHelper.visible = v; });
            const btnRotate = createToolbarBtn("pi pi-sync", "Auto-Rotate", false, (v) => { autoRotate = v; });
            const btnWire = createToolbarBtn("pi pi-box", "Wireframe", false, (v) => {
                showWireframe = v;
                applyMaterialMode();
            });

            const btnResetCam = document.createElement("button");
            Object.assign(btnResetCam.style, {
                background: "transparent", color: "#aaa", border: "1px solid #444",
                borderRadius: "4px", padding: "4px 10px", fontSize: "11px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "6px"
            });
            btnResetCam.innerHTML = `<i class="pi pi-compass"></i><span>Reset View</span>`;
            btnResetCam.onclick = (e) => {
                e.stopPropagation();
                if (currentModel) fitCameraToObject(camera, currentModel, controls, THREE);
            };

            const btnSettings = createToolbarBtn("pi pi-sliders-h", "Settings", false, (v) => {
                settingsPanel.style.display = v ? "flex" : "none";
            });

            const exportSelect = createSelect([
                { value: "", label: "Export As..." },
                { value: "OBJ", label: "OBJ (.obj)" },
                { value: "GLB", label: "GLB / GLTF" },
                { value: "STL", label: "STL (.stl)" }
            ], "", (val) => {
                if (val) {
                    exportModel(val);
                    exportSelect.value = "";
                }
            });
            exportSelect.style.background = "#1e293b";
            exportSelect.style.borderColor = "#3b82f6";
            exportSelect.style.color = "#93c5fd";

            toolbar.append(btnGrid, btnWire, btnRotate, btnResetCam, btnSettings, exportSelect);
            overlay.container.appendChild(toolbar);

            const onResize = () => {
                if (!canvasContainer || !renderer || !cameraPersp || !cameraOrtho) return;
                const width = canvasContainer.clientWidth;
                const height = canvasContainer.clientHeight;
                const aspect = width / height;

                cameraPersp.aspect = aspect;
                cameraPersp.updateProjectionMatrix();

                const d = 2;
                cameraOrtho.left = -d * aspect;
                cameraOrtho.right = d * aspect;
                cameraOrtho.top = d;
                cameraOrtho.bottom = -d;
                cameraOrtho.updateProjectionMatrix();

                renderer.setSize(width, height);
            };
            window.addEventListener("resize", onResize);
            overlay.addCleanup(() => window.removeEventListener("resize", onResize));

            const animate = () => {
                animId = requestAnimationFrame(animate);
                if (autoRotate && currentModel) currentModel.rotation.y += 0.008;
                controls.update();
                renderer.render(scene, camera);
            };
            animate();
        }

        if (currentModel) {
            scene.remove(currentModel);
            currentModel = null;
        }

        try {
            const ext = (srcUrl.split("?")[0].split(".").pop() || "glb").toLowerCase();
            let loadedObj = null;

            if (ext === "obj" && THREE.OBJLoader) {
                const loader = new THREE.OBJLoader();
                loadedObj = await loader.loadAsync(srcUrl);
            } else if (ext === "stl" && THREE.STLLoader) {
                const loader = new THREE.STLLoader();
                const geometry = await loader.loadAsync(srcUrl);
                const material = new THREE.MeshStandardMaterial({ color: 0x90caf9, roughness: 0.4, metalness: 0.2 });
                loadedObj = new THREE.Mesh(geometry, material);
            } else if (ext === "ply" && THREE.PLYLoader) {
                const loader = new THREE.PLYLoader();
                const geometry = await loader.loadAsync(srcUrl);
                const material = new THREE.MeshStandardMaterial({ color: 0x90caf9, roughness: 0.4 });
                loadedObj = new THREE.Mesh(geometry, material);
            } else if (THREE.GLTFLoader) {
                const loader = new THREE.GLTFLoader();
                const gltfData = await loader.loadAsync(srcUrl);
                loadedObj = gltfData.scene || gltfData.scenes?.[0];
            }

            if (loadedObj) {
                currentModel = loadedObj;
                currentModel.traverse((child) => {
                    if (child.isMesh && child.material) child._originalMaterial = child.material;
                });
                applyMaterialMode();
                applyUpDirection();
                scene.add(currentModel);
                fitCameraToObject(camera, currentModel, controls, THREE);
                gridHelper.position.y = new THREE.Box3().setFromObject(currentModel).min.y;
            }
        } catch (err) {
            console.error("Comfy Sidebar: Failed to parse 3D model", err);
            loadingSpinner.innerHTML = `<span style="color:#f87171;">Failed to load 3D format</span>`;
            return;
        }

        loadingSpinner.style.display = "none";
    };

    function fitCameraToObject(cam, obj, ctrl, THREE) {
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        if (cam.isPerspectiveCamera) {
            const fov = cam.fov * (Math.PI / 180);
            let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
            cam.position.set(center.x, center.y + size.y * 0.2, center.z + cameraZ);
        } else if (cam.isOrthographicCamera) {
            cam.position.set(center.x, center.y + size.y * 0.2, center.z + maxDim * 2);
        }

        cam.lookAt(center);
        ctrl.target.copy(center);
        ctrl.update();
    }

    initSceneAndLoad(baseSrc);

    return {
        is3D: true,
        loadTarget(targetSrc) {
            if (!is3DFormat(targetSrc)) {
                overlay.destroy();
                onSwitchMedia(targetSrc);
                return;
            }
            initSceneAndLoad(targetSrc);
        },
        destroy: () => overlay.destroy()
    };
}