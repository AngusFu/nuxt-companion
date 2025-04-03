import { parseSync } from "@oxc-parser/wasm";
import { processCallExpression } from "../api-parser";
import { describe, it, expect } from "@jest/globals";
import * as t from "@oxc-project/types";
import * as esquery from "esquery";

describe("API Parser", () => {
  // 辅助函数：将代码字符串解析为 AST
  function parseCode(code: string) {
    const parsed = parseSync(code, { sourceFilename: "test.ts" });
    const ast = JSON.parse(parsed.programJson);
    parsed.free();
    return ast;
  }
  const eQuery = (node: t.Span, selector: string) =>
    esquery.query(node as any, selector);

  function processCallExpressions(ast: t.Span) {
    return (eQuery(ast, "CallExpression") as t.CallExpression[])
      .filter((el) => el.arguments?.length)
      .map((el, index) => processCallExpression(el));
  }

  describe("processAst - 查找 API 调用", () => {
    it("应该能找到所有类型的 API 调用", () => {
      // 测试各种 API 调用格式
      const code = `
        // 1. 直接函数调用
        api("/users");

        // 2. HTTP 方法调用
        api.get("/users");    // GET 请求
        api.post("/users");   // POST 请求
        api.put("/users");    // PUT 请求
        api.delete("/users"); // DELETE 请求
        api.patch("/users");  // PATCH 请求
        api.head("/users");   // HEAD 请求
        api.options("/users");// OPTIONS 请求
      `;

      const ast = parseCode(code);
      const calls = processCallExpressions(ast);

      // 验证找到了所有 8 种调用方式
      expect(calls).toHaveLength(8);
    });

    it("应该能处理嵌套的 API 调用", () => {
      const code = `
        // 1. 嵌套在条件语句中
        if (condition) {
          api("/users");
        }

        // 2. 嵌套在函数中
        function fetchData() {
          api.get("/users");
        }

        // 3. 嵌套在对象方法中
        const service = {
          fetchUsers() {
            api.post("/users");
          }
        }

        // 4. 嵌套在箭头函数中
        const fetch = () => api.put("/users");

        // 5. 嵌套在 Promise 链中
        Promise.resolve().then(() => api.delete("/users"));
      `;

      const ast = parseCode(code);
      const calls = processCallExpressions(ast);

      // 验证找到了所有 5 个 API 调用
      expect(calls).toHaveLength(5);
    });

    it("应该能处理复杂的 API 调用链", () => {
      const code = `
        // 1. 链式调用
        api.get("/users").then(res => res.json());

        // 2. 方法链
        api.post("/users", { data: { name: "test" } })
          .then(res => res.json())
          .catch(err => console.error(err));

        // 3. 条件链
        const result = condition
          ? api.put("/users", { data: { name: "test" } })
          : api.delete("/users");

        // 4. 对象方法链
        const service = {
          fetch() {
            return api.get("/users");
          }
        }.fetch();
      `;

      const ast = parseCode(code);
      const calls = processCallExpressions(ast);

      // 验证找到了所有 5 个 API 调用
      expect(calls).toHaveLength(5);
    });

    it("应该忽略非 API 调用", () => {
      const code = `
        // 1. 普通函数调用
        console.log("test");
        Math.max(1, 2);
        Array.from([1, 2, 3]);

        // 2. 对象方法调用
        const obj = {
          method() {
            return "test";
          }
        };
        obj.method();

        // 3. 类方法调用
        class Test {
          static method() {
            return "test";
          }
        }
        Test.method();

        // 4. 构造函数调用
        new Date();
        new Array(3);

        // 5. 内置方法调用
        "test".toUpperCase();
        [1, 2, 3].map(x => x * 2);
      `;

      const ast = parseCode(code);
      const calls = processCallExpressions(ast);

      // 验证没有找到任何 API 调用
      expect(calls).toHaveLength(0);
    });

    it("应该能处理 axios 调用", () => {
      const code = `
        // 1. 直接函数调用
        axios("/users");

        // 2. HTTP 方法调用
        axios.get("/users");    // GET 请求
        axios.post("/users");   // POST 请求
        axios.put("/users");    // PUT 请求
        axios.delete("/users"); // DELETE 请求
        axios.patch("/users");  // PATCH 请求
        axios.head("/users");   // HEAD 请求
        axios.options("/users");// OPTIONS 请求

        // 3. 配置对象调用
        axios({
          url: "/users",
          method: "GET"
        });

        // 4. 链式调用
        axios.get("/users").then(res => res.data);

        // 5. 嵌套调用
        function fetchData() {
          return axios.get("/users");
        }
      `;

      const ast = parseCode(code);
      const calls = processCallExpressions(ast);

      // 验证找到了所有 11 个 API 调用
      expect(calls).toHaveLength(11);
    });

    it("应该能处理自定义 API 调用", () => {
      const code = `
        // 1. 自定义函数名
        request("/users");
        customAPI("/users");
        myAPI("/users");

        // 2. 自定义对象的方法调用
        request.get("/users");
        customAPI.post("/users");
        myAPI.put("/users");

        // 3. 嵌套的方法调用
        api.v1.get("/users");
        client.api.post("/users");
        service.rest.v2.delete("/users");

        // 4. 自定义对象的配置调用
        request({ url: "/users", method: "GET" });
        customAPI({ endpoint: "/users", method: "POST" });

        // 5. 链式调用
        a.b.c("/users");
        x.y.z.get("/users");
        service.api.v1.users.post("/users");

        // 6. 更多链式调用变体
        x.b.c.get("/users");                    // 直接链式调用
        x().b.c.post("/users");                 // 函数调用后链式调用
        x.b().c.put("/users");                 // 中间方法调用后链式调用
        x.b()['c'].delete("/users");           // 使用方括号访问属性
        x.b.c()['d'].patch("/users");          // 混合链式调用
        x().b().c().get("/users");             // 多重函数调用链
        x.b()['c']()['d'].post("/users");      // 多重方括号访问
        x.b.c.d.e.f.get("/users");             // 深层链式调用
        x().b().c().d().e().put("/users");     // 深层函数调用链
        a.b().c("/api/users");
        a.b()['c']("/api/users");
        a.b()['c']['get']("/api/users");
      `;

      const ast = parseCode(code);
      const calls = processCallExpressions(ast);

      // 验证找到了所有 26 个 API 调用
      expect(calls).toHaveLength(26);
    });
  });

  describe("processAst - 解析 API 调用信息", () => {
    describe("基本调用格式", () => {
      it("应该能解析简单的 API 调用 - api('/users')", () => {
        const code = `api("/users")`;
        const ast = parseCode(code);

        const info = processCallExpressions(ast)[0];

        expect(info).toEqual({
          glob: "users", // 路径
          method: "get", // 默认方法为 GET
          filter: expect.any(Function),
        });
      });

      it("应该能解析带方法的 API 调用 - api.post('/users')", () => {
        const code = `api.POST("/users")`;
        const ast = parseCode(code);

        const info = processCallExpressions(ast)[0];

        expect(info).toEqual({
          glob: "users",
          method: "post", // 方法应该被转换为小写
          filter: expect.any(Function),
        });
      });
    });

    describe("配置对象格式", () => {
      it("应该能解析配置对象中的方法 - api('/users', { method: 'POST' })", () => {
        const code = `api("/users", { method: "POST" })`;
        const ast = parseCode(code);

        const info = processCallExpressions(ast)[0];

        expect(info).toEqual({
          glob: "users",
          method: "post", // 从配置对象中获取方法
          filter: expect.any(Function),
        });
      });

      it("应该能解析单个配置对象 - api({ url: '/users', method: 'POST' })", () => {
        const code = `api({ url: "/users", method: "POST" })`;
        const ast = parseCode(code);

        const info = processCallExpressions(ast)[0];

        expect(info).toEqual({
          glob: "users",
          method: "post",
          filter: expect.any(Function),
        });
      });

      it("应该支持多种路径属性名", () => {
        // 测试所有支持的路径属性名
        const pathProps = ["url", "api", "endpoint", "uri", "path"];

        pathProps.forEach((prop) => {
          const code = `api({ ${prop}: "/users" })`;
          const ast = parseCode(code);

          const info = processCallExpressions(ast)[0];

          expect(info).toEqual({
            glob: "users",
            method: "get", // 没有指定方法时使用默认值
            filter: expect.any(Function),
          });
        });
      });
    });

    describe("高级特性", () => {
      it("应该能处理模板字符串 - api(`/users/${id}`)", () => {
        const code = "api(`/users/${id}`)";
        const ast = parseCode(code);

        const info = processCallExpressions(ast)[0];

        expect(info).toEqual({
          glob: "users/*", // 动态部分被替换为通配符
          method: "get",
          filter: expect.any(Function),
        });
      });

      it("应该能处理复杂的 URL 路径", () => {
        const testCases = [
          {
            code: 'api("/api/v1/users/123/posts/456/comments")',
            expected: {
              glob: "api/v1/users/123/posts/456/comments",
              method: "get",
              filter: expect.any(Function),
            },
            matches: [
              "/api/v1/users/123/posts/456/comments",
              "/api/v1/users/123/posts/456/comments/",
            ],
            nonMatches: ["/api/v1/users/123/posts/456"],
          },
        ];

        testCases.forEach(({ code, expected, matches, nonMatches }) => {
          const ast = parseCode(code);

          const info = processCallExpressions(ast)[0];

          // 验证基本信息
          expect(info).toEqual(expected);

          // 验证路径匹配
          const filter = info!.filter;
          matches.forEach((path) => {
            expect(filter(path)).toBe(true);
          });
          nonMatches.forEach((path) => {
            expect(filter(path)).toBe(false);
          });
        });
      });
    });
  });
});
