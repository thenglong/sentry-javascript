const request = new Request('http://localhost:7654/foo', {
  method: 'POST',
  credentials: 'include',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Cache: 'no-cache',
  },
  body: JSON.stringify({ test: true }),
});

fetch(request, {
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Cache: 'cache',
  },
});
