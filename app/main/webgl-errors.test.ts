import { describe, expect, it } from "vitest";
import { webglErrors } from "./webgl-errors.ts";

describe("WebGL errors on a page's console", () => {
  it("counts every WebGL error a page reports, and nothing else", () => {
    const errors = webglErrors();
    for (let i = 0; i < 3; i++) errors.note("[.WebGL-0x13c00a1e00]GL_INVALID_OPERATION: glDrawElements: Mismatch between texture format and sampler type (signed/unsigned/float/shadow).");
    errors.note("[.WebGL-0x13c00b2f00]GL_INVALID_OPERATION: glDrawElements: Mismatch between texture format and sampler type (signed/unsigned/float/shadow).");
    errors.note("WebGL: INVALID_VALUE: texImage2D: no canvas");
    errors.note("THREE.WebGLProgram: Shader Error 1282 - VALIDATE_STATUS false\n\nMaterial Name: \nMaterial Type: ShaderMaterial");
    // Warnings that break no draw, and a context the page lets go of, are not errors.
    errors.note("[.WebGL-0x13c00a1e00]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels");
    errors.note("WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost");
    errors.note("THREE.WebGLRenderer: Context Lost.");
    errors.note("Failed to load resource: net::ERR_FILE_NOT_FOUND");
    expect(errors.count()).toBe(6);
  });
});
