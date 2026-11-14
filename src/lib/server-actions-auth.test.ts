import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Server Actions and Route Handlers are public HTTP endpoints, so each one must check the login
// itself (src/proxy.ts only redirects page visits). This test reads the source and fails if an
// exported action does not call getStaffContext() before it touches the database.

const SRC = path.resolve(__dirname, "..");
/** Actions that run without a staff session by design (they create / clear it). */
const PUBLIC_ACTIONS = new Set(["signIn", "signOut"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function isUseServerFile(sf: ts.SourceFile): boolean {
  const first = sf.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const files = walk(SRC);
const actionFiles = files.map(parse).filter(isUseServerFile);

describe("server actions check the login first", () => {
  it("finds the action files", () => {
    const names = actionFiles.map((sf) => path.relative(SRC, sf.fileName)).sort();
    expect(names).toEqual(["lib/actions.ts", "lib/auth-actions.ts", "lib/invoice-actions.ts", "lib/settings-actions.ts"]);
  });

  for (const sf of actionFiles) {
    const rel = path.relative(SRC, sf.fileName);

    it(`${rel}: exports only async functions`, () => {
      // An exported const arrow function would escape the check below.
      const exportedOther = sf.statements.filter(
        (s) => isExported(s) && !ts.isFunctionDeclaration(s) && !ts.isInterfaceDeclaration(s) && !ts.isTypeAliasDeclaration(s)
      );
      expect(exportedOther.map((s) => s.getText().slice(0, 60))).toEqual([]);
    });

    for (const fn of sf.statements.filter(ts.isFunctionDeclaration).filter(isExported)) {
      const name = fn.name?.text ?? "(anonymous)";
      if (PUBLIC_ACTIONS.has(name)) continue;
      it(`${rel}: ${name}() calls getStaffContext() before using the database`, () => {
        const body = fn.body?.getText() ?? "";
        const auth = body.indexOf("getStaffContext(");
        expect(auth, `${name} never calls getStaffContext()`).toBeGreaterThanOrEqual(0);
        for (const dbCall of ["createServerClient(", "fetchInvoice(", ".rpc(", ".from("]) {
          const at = body.indexOf(dbCall);
          if (at >= 0) expect(auth, `${name} calls ${dbCall} before getStaffContext()`).toBeLessThan(at);
        }
      });
    }
  }
});

describe("route handlers check the login", () => {
  const routes = files.filter((f) => /[/\\]route\.ts$/.test(f));

  it("finds the route handlers", () => {
    expect(routes.map((f) => path.relative(SRC, f)).sort()).toEqual([
      "app/api/exports/daily-lines/route.ts",
      "app/api/exports/daily-summary/route.ts",
    ]);
  });

  for (const file of routes) {
    it(`${path.relative(SRC, file)} requires an admin`, () => {
      const text = readFileSync(file, "utf8");
      if (text.includes("getStaffContext(")) {
        expect(text).toContain('getStaffContext("admin")');
      } else {
        // Delegates to the shared export handler, which checks the admin role first.
        expect(text).toMatch(/return exportDailyCsv\(request, "(summary|lines)"\)/);
        const exportsSrc = readFileSync(path.join(SRC, "lib/exports.ts"), "utf8");
        const handler = exportsSrc.slice(exportsSrc.indexOf("export async function exportDailyCsv"));
        expect(handler.indexOf('getStaffContext("admin")')).toBeGreaterThan(0);
        expect(handler.indexOf('getStaffContext("admin")')).toBeLessThan(handler.indexOf("createServerClient("));
      }
    });
  }
});

describe("admin-only actions", () => {
  const ADMIN_ONLY: Record<string, string[]> = {
    "lib/actions.ts": ["createProduct", "updateProduct", "deleteProduct", "addProductBarcode", "removeProductBarcode"],
    "lib/settings-actions.ts": ["updateStoreSettings", "updateCounter"],
  };
  for (const [rel, names] of Object.entries(ADMIN_ONLY)) {
    const sf = parse(path.join(SRC, rel));
    for (const name of names) {
      it(`${rel}: ${name}() requires an admin`, () => {
        const fn = sf.statements.filter(ts.isFunctionDeclaration).find((f) => f.name?.text === name);
        expect(fn, `${name} not found`).toBeDefined();
        expect(fn!.body!.getText()).toContain('getStaffContext("admin")');
      });
    }
  }
});
