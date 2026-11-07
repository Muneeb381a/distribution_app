import { testUrl } from './db-url.mjs';
import { OWNER_PASSWORD } from './global-setup.mjs';

/** Starts the compiled app on a random port against the test database. */
export async function boot() {
  process.env.DATABASE_URL = testUrl();
  process.env.JWT_SECRET ??= 'test-secret';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/app.module.js');
  const { configureApp } = await import('../dist/setup.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;

  const as = (token) => {
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      return { status: res.status, body: json };
    };
    return {
      get: (p) => call('GET', p),
      post: (p, b = {}) => call('POST', p, b),
      put: (p, b) => call('PUT', p, b),
      patch: (p, b) => call('PATCH', p, b),
      delete: (p) => call('DELETE', p),
    };
  };

  const login = async (username, password) => {
    const r = await as().post('/auth/login', { username, password });
    return { ...r, api: as(r.body?.accessToken) };
  };
  const owner = (await login('owner', OWNER_PASSWORD)).api;
  return { app, base, as, login, owner, close: () => app.close() };
}

/** Throws with the response body if a setup call failed, so a broken fixture is obvious. */
export function ok(res) {
  if (res.status >= 300) throw new Error(`setup call failed [${res.status}] ${JSON.stringify(res.body)}`);
  return res.body;
}

let counter = 0;
export const uniq = (p) => `${p} ${Date.now().toString(36)}${counter++}`;

/** Common fixtures: a returnable bottle product (carton of 6) with prices, a supplier and the godown stocked with `cartons` cartons. */
export async function stockedWorld(owner, cartons = 50) {
  const locations = ok(await owner.get('/locations'));
  const godown = locations.find((l) => l.type === 'GODOWN');
  const shop = locations.find((l) => l.type === 'SHOP');
  const category = ok(await owner.get('/categories?line=BOTTLES'))[0];
  const product = ok(await owner.post('/products', {
    categoryId: category.id, name: uniq('Cola'), size: '1.5 L', baseUnit: 'BOTTLE', returnableEmpty: true,
    units: [{ unitName: 'BOTTLE', factorToBase: 1 }, { unitName: 'CARTON', factorToBase: 6 }],
  }));
  ok(await owner.put(`/product-prices/${product.id}`, { prices: [{ unitName: 'BOTTLE', rate: 125 }, { unitName: 'CARTON', rate: 750 }] }));
  const supplier = ok(await owner.post('/suppliers', { name: uniq('Supplier') }));
  ok(await owner.post('/purchases', {
    supplierId: supplier.id, locationId: godown.id, paidNow: 2000,
    items: [{ productId: product.id, unitName: 'CARTON', qty: cartons, unitPrice: 600 }],
  }));
  const stockOf = async (locationId, status = 'ok') => {
    const rows = ok(await owner.get(`/stock?locationId=${locationId}&search=${encodeURIComponent(product.name)}`));
    return Number(rows.find((r) => r.productId === product.id)?.[status] ?? 0);
  };
  return { godown, shop, product, supplier, stockOf };
}
