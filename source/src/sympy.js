// S's maths engine: real Python + SymPy running inside the browser (Pyodide, in a Web Worker
// so the app never freezes). The AI writes SymPy code, S runs it here and gets exact answers.
// It downloads once (about 15 MB) the first time it is needed; after that the browser caches it.

export const PYODIDE_VERSION = "314.0.7";
const CORE_URL = `https://cdn.jsdelivr.net/npm/pyodide@${PYODIDE_VERSION}/`;
const PACKAGES_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const RUN_TIMEOUT_MS = 45000; // a single calculation
const LOAD_TIMEOUT_MS = 180000; // first download on a slow connection

// The Python side: run the code with everything from SymPy ready, print the value of the
// last line (like a notebook), and send back what it printed or the error.
const PRELUDE = `
import sys, io, ast, traceback
def __s_run(src):
    import sympy
    g = {"__name__": "__main__"}
    exec("from sympy import *\\nx, y, z, t, a, b, c, k, m, n = symbols('x y z t a b c k m n')", g)
    buf = io.StringIO()
    old = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = buf
    try:
        tree = ast.parse(src)
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        exec(compile(tree, "<sympy>", "exec"), g)
        if last is not None:
            value = eval(compile(last, "<sympy>", "eval"), g)
            if value is not None:
                print(value)
    except BaseException:
        etype, evalue, tb = sys.exc_info()
        print("Error: " + "".join(traceback.format_exception_only(etype, evalue)).strip())
    finally:
        sys.stdout, sys.stderr = old
    out = buf.getvalue().strip()
    if len(out) > 8000:
        out = out[:4000] + "\\n... (output shortened) ...\\n" + out[-3000:]
    return out or "(no output: use print() to show results)"
`;

const WORKER_SOURCE = `
let py = null;
async function init(core, packages, prelude) {
  const { loadPyodide } = await import(core + "pyodide.mjs");
  py = await loadPyodide({ indexURL: core, packageBaseUrl: packages });
  await py.loadPackage(["sympy"]);
  py.runPython(prelude);
}
let ready = null;
onmessage = async ({ data }) => {
  if (data.type === "init") {
    ready ??= init(data.core, data.packages, data.prelude);
    try { await ready; postMessage({ type: "ready" }); }
    catch (e) { postMessage({ type: "failed", error: String(e && e.message || e) }); }
    return;
  }
  try {
    await ready;
    const run = py.globals.get("__s_run");
    const out = run(data.code);
    run.destroy();
    postMessage({ id: data.id, out });
  } catch (e) {
    postMessage({ id: data.id, out: "Error: " + String(e && e.message || e) });
  }
};
`;

let worker = null;
let readyPromise = null;
let nextId = 1;
const waiting = new Map();

function startWorker() {
  // Pyodide needs a module worker. A data: URL works everywhere, even when S.html is opened as a file.
  try {
    worker = new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(WORKER_SOURCE), { type: "module" });
  } catch {
    // Some browsers (older iPhone Safari) refuse data: workers; a blob: worker works there on https pages.
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })), { type: "module" });
  }
  readyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The maths engine took too long to download. Check your internet.")), LOAD_TIMEOUT_MS);
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        clearTimeout(timer);
        resolve();
      } else if (data.type === "failed") {
        clearTimeout(timer);
        reject(new Error("The maths engine couldn't load: " + data.error));
      } else {
        waiting.get(data.id)?.(data.out);
        waiting.delete(data.id);
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error("The maths engine couldn't start: " + (e.message || "unknown error")));
    };
  });
  readyPromise.catch(() => stopWorker());
  worker.postMessage({ type: "init", core: CORE_URL, packages: PACKAGES_URL, prelude: PRELUDE });
}

function stopWorker() {
  worker?.terminate();
  worker = null;
  readyPromise = null;
  for (const done of waiting.values()) done("Error: the calculation was stopped.");
  waiting.clear();
}

export const sympyLoaded = () => !!worker;

// Start downloading early (for example when the user opens a maths chat) so the first answer is quicker.
export function warmUpSympy() {
  if (!worker) startWorker();
  return readyPromise;
}

// Run SymPy code and return what it printed (or the error text, which the AI can use to fix its code).
export async function runSympy(code, signal) {
  if (!worker) startWorker();
  try {
    await readyPromise;
  } catch (e) {
    return `Error: ${e.message} Solve it by hand instead.`;
  }
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Stuck (for example an integral with no closed form): restart the engine.
      stopWorker();
      resolve("Error: the calculation took longer than 45 seconds and was stopped. Try a simpler or numeric approach (e.g. N(), nsolve, Integral(...).evalf()).");
    }, RUN_TIMEOUT_MS);
    const onAbort = () => {
      clearTimeout(timer);
      stopWorker();
      resolve("Error: stopped by the user.");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    waiting.set(id, (out) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(out);
    });
    worker.postMessage({ id, code });
  });
}

// How the tool is described to the AI.
export const SYMPY_TOOL = {
  name: "run_sympy",
  description:
    "Run Python code with SymPy to do exact maths: algebra, equations and systems, calculus (limits, derivatives, integrals, series), differential equations, matrices and linear algebra, number theory, trigonometric simplification, probability, and precise arithmetic. Everything from `sympy` is already imported, and x, y, z, t, a, b, c, k, m, n are symbols. The value of the last line is printed automatically; use print() for more results. Returns the printed output or the error.",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string", description: "Python code using SymPy, for example: solve(x**2 - 5*x + 6, x)" },
    },
    required: ["code"],
  },
};
