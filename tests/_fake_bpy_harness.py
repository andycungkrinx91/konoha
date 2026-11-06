"""Shared fake bpy harness mirroring the measured Blender 5.2.2 build.

The engine enum is stale (lists only BLENDER_EEVEE) while assigning CYCLES works and
OPTIX/CUDA devices are visible. Imported by the GPU engine-selection and render-failover
suites so neither duplicates the fake. No Blender is required.
"""

import os
import shutil
import sys
import tempfile
import types as pytypes
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "mcp", "three_asset"))

if "mathutils" not in sys.modules:
    class _Vector(tuple):
        def __new__(cls, values):
            return super().__new__(cls, values)

        def __add__(self, other):
            return _Vector(a + b for a, b in zip(self, other))

        def __sub__(self, other):
            return _Vector(a - b for a, b in zip(self, other))

        def __getattr__(self, name):
            index = {"x": 0, "y": 1, "z": 2}.get(name)
            if index is None:
                raise AttributeError(name)
            return self[index]

    sys.modules["mathutils"] = pytypes.SimpleNamespace(Vector=_Vector)

import blender_worker_compute as compute  # noqa: E402
import blender_worker_views as views  # noqa: E402


# --------------------------------------------------------------------------- #
# Fake bpy
# --------------------------------------------------------------------------- #
class FakeDevice:
    def __init__(self, name, device_type):
        self.name = name
        self.type = device_type
        self.use = False


class FakeCyclesPrefs:
    def __init__(self, devices):
        self.devices = [FakeDevice(n, t) for n, t in devices]
        self.compute_device_type = "NONE"
        self.refresh_count = 0

    def refresh_devices(self):
        self.refresh_count += 1

    def get_devices(self):
        return list(self.devices)

    def get_devices_for_type(self, device_type):
        return [
            d for d in self.devices
            if d.type == device_type and d.type != "CPU"
        ]

    def has_optixdenoiser_gpu_devices(self):
        return any(d.type == "OPTIX" for d in self.devices)


class FakeCyclesSettings:
    def __init__(self):
        self.samples = 64
        self.device = "CPU"
        self.use_denoising = False
        self.denoiser = None


class FakeRender:
    def __init__(self, engine_enum):
        self._engine_enum = list(engine_enum)
        self._engine = self._engine_enum[0]
        self.engine_assignments = []
        self.resolution_x = 1920
        self.resolution_y = 1080
        self.resolution_percentage = 100
        self.film_transparent = False
        self.filepath = ""
        self.image_settings = type("IS", (), {"file_format": "PNG"})()

    @property
    def engine(self):
        return self._engine

    @engine.setter
    def engine(self, value):
        self.engine_assignments.append(value)
        if value not in self._engine_enum and value != "CYCLES":
            raise TypeError("enum %r not found in %r" % (value, self._engine_enum))
        self._engine = value


class FakeSceneCollection:
    def __init__(self, scene):
        self.objects = _LinkList(scene)


class _LinkList(list):
    def __init__(self, scene):
        super().__init__()
        self._scene = scene

    def link(self, obj):
        self.append(obj)
        self._scene.objects.append(obj)


class FakeScene:
    def __init__(self, engine_enum):
        self.render = FakeRender(engine_enum)
        self.cycles = FakeCyclesSettings()
        self.objects = []
        self.collection = FakeSceneCollection(self)
        self.world = None
        self.camera = None
        self.konoha_cycles_samples = 0


class FakeBackgroundNode:
    def __init__(self):
        self.inputs = {
            "Color": type("S", (), {"default_value": (0, 0, 0, 1)})(),
            "Strength": type("S", (), {"default_value": 1.0})(),
        }


class FakeNodeTree:
    def __init__(self):
        self.nodes = {"Background": FakeBackgroundNode()}


class FakeWorld:
    def __init__(self):
        self.use_nodes = False
        self.node_tree = FakeNodeTree()


class FakeWorlds:
    def __init__(self):
        self.created = []

    def new(self, name):
        world = FakeWorld()
        self.created.append(name)
        return world


class FakeLightData:
    def __init__(self, name, light_type="AREA"):
        self.name = name
        self.type = light_type
        self.energy = 0.0
        self.size = 0.0
        self.use_shadow = True


class FakeObject:
    def __init__(self, name, obj_type="LIGHT", data=None):
        self.name = name
        self.type = obj_type
        self.data = data
        self.location = (0.0, 0.0, 0.0)
        self.rotation_euler = (0.0, 0.0, 0.0)


class FakeObjectStore(list):
    """`bpy.data.<thing>` collection that supports `.new` and `.remove`."""

    def __init__(self):
        super().__init__()
        self.removed = []

    def new(self, name, type="AREA"):  # noqa: A002 - mirrors Blender's signature
        data = FakeLightData(name, type)
        self.append(data)
        return data

    def remove(self, item, do_unlink=True):
        self.removed.append(item)
        if item in self:
            super().remove(item)


class FakeCameraData:
    def __init__(self, name):
        self.name = name


class FakeCameraStore(FakeObjectStore):
    def new(self, name):
        return FakeCameraData(name)


class FakeData:
    def __init__(self):
        self.worlds = FakeWorlds()
        self.lights = FakeObjectStore()
        self.objects = FakeObjectStore()
        self.meshes = FakeObjectStore()
        self.cameras = FakeCameraStore()


class FakeAddons(dict):
    pass


class FakePreferences:
    def __init__(self, cycles_prefs):
        self.addons = FakeAddons()
        if cycles_prefs is not None:
            self.addons["cycles"] = type("E", (), {"preferences": cycles_prefs})()


class FakeContext:
    def __init__(self, scene, preferences):
        self.scene = scene
        self.preferences = preferences


class FakeEngineEnumItem:
    def __init__(self, identifier):
        self.identifier = identifier


class FakeRenderSettings:
    def __init__(self, engine_enum):
        self.bl_rna = type(
            "RNA", (), {"properties": {
                "engine": type("P", (), {
                    "enum_items": [FakeEngineEnumItem(e) for e in engine_enum],
                })(),
            }},
        )()


class FakeBpy:
    """Mirrors the real build: stale enum, but CYCLES assignable."""

    render_cls = FakeRender

    def __init__(self, cycles_assignable=True, devices=None):
        engine_enum = ["BLENDER_EEVEE"] if cycles_assignable else ["BLENDER_EEVEE"]
        self.scene = FakeScene(engine_enum)
        if self.render_cls is not FakeRender:
            old = self.scene.render
            self.scene.render = self.render_cls(engine_enum)
            self.scene.render.engine_assignments = old.engine_assignments
        prefs = FakeCyclesPrefs(
            devices if devices is not None
            else [("NVIDIA GeForce RTX 3050 Laptop GPU", "CUDA"),
                  ("AMD Ryzen 9 5900HX", "CPU"),
                  ("NVIDIA GeForce RTX 3050 Laptop GPU", "OPTIX")]
        )
        self.context = FakeContext(self.scene, FakePreferences(prefs))
        self.data = FakeData()
        self.types = type("T", (), {"RenderSettings": FakeRenderSettings(engine_enum)})()
        self.ops = type("Ops", (), {"preferences": type(
            "P", (), {"addon_enable": staticmethod(lambda module=None: None)})()})()
        self.app = type("App", (), {"version": (5, 2, 2)})()


class RejectingRender(FakeRender):
    """CYCLES assignment genuinely raises, as on a build without cycles."""

    @FakeRender.engine.setter
    def engine(self, value):  # noqa: A003 - mirrors Blender
        if value == "CYCLES":
            self.engine_assignments.append(value)
            raise TypeError("enum CYCLES not found in 'BLENDER_EEVEE'")
        FakeRender.engine.fset(self, value)


class LyingRender(FakeRender):
    """Setter accepts CYCLES but the engine silently reads back as EEVEE."""

    @FakeRender.engine.setter
    def engine(self, value):  # noqa: A003 - mirrors Blender
        FakeRender.engine.fset(self, "BLENDER_EEVEE" if value == "CYCLES" else value)


class RejectingBpy(FakeBpy):
    """Real build whose CYCLES assignment genuinely raises."""

    render_cls = RejectingRender


class AcceptingButNotCyclesBpy(FakeBpy):
    """Setter accepts CYCLES but the value silently reads back as EEVEE."""

    render_cls = LyingRender


def with_dry_ops(bpy):
    """Give the fake a render op that renders a real Cycles frame when asked.

    The dry op simulates Blender's behaviour: a real render runs on the scene's
    configured engine. For CYCLES it records the compute device so tests can
    assert the engine/device pairing that was actually used.
    """
    renders = []

    def render(write_still=False):
        renders.append({
            "engine": bpy.context.scene.render.engine,
            "cycles_device": bpy.context.scene.cycles.device,
            "samples": bpy.context.scene.cycles.samples,
        })

    bpy.ops.render = type("R", (), {"render": staticmethod(render)})()
    return renders


def with_failing_ops(bpy, failures):
    """Give the fake a render op that fails the way a real GPU render does.

    ``failures`` maps a compute device to what happens when that device renders:
    a ``(exception_class, message, partial)`` tuple, or a callable
    ``(path, calls)``. A ``partial=True`` failure writes the file before raising,
    which is exactly how Blender leaves behind the views it already finished.
    """
    calls = []

    def make_ops():
        def render(write_still=False):
            scene = bpy.context.scene
            device = scene.cycles.device
            path = scene.render.filepath
            entry = {"engine": scene.render.engine, "device": device, "path": path}
            calls.append(entry)
            # A Cycles GPU queue handles one backend type at a time (OPTIX/CUDA);
            # key the injected failure by that backend, not by "GPU".
            backend = device
            if scene.render.engine == "CYCLES" and device != "CPU":
                backend = str(
                    bpy.context.preferences.addons["cycles"].preferences.compute_device_type
                ).upper() or device
            entry["backend"] = backend
            failure = failures.get(backend)
            if failure is None:
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write("png")
                entry["outcome"] = "ok"
                return
            entry["outcome"] = "raised"
            if callable(failure):
                failure(path, calls)
                return
            kind, message, partial = failure
            if partial:
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write("partial")
            raise kind(message)

        return render

    bpy.ops.render = type("R", (), {"render": staticmethod(make_ops())})
    return calls


# --------------------------------------------------------------------------- #
# Reset shared module state between tests
# --------------------------------------------------------------------------- #
def reset_module_state():
    compute._LAST_COMPUTE_INFO.clear()
    compute._LAST_COMPUTE_INFO.update({
        "compute_backend": "BLENDER_EEVEE",
        "device": "EEVEE_GPU",
        "gpu_unavailable": False,
        "gpu_fallback_reason": None,
    })
    compute._LAST_RENDER_ENGINE["value"] = None


def fresh_bpy(cls=FakeBpy, **kwargs):
    """Fake bpy with any scene lights from earlier tests stripped."""
    bpy = cls(**kwargs)
    bpy.scene.objects = []
    return bpy


