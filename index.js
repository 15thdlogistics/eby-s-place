export default {
  async fetch(request, env) {

    const url = new URL(request.url)

    // ==============================
    // 1️⃣ SERVE ADMIN DASHBOARD UI
    // ==============================
    if (request.method === "GET" && url.pathname === "/") {
      return renderAdminHTML()
    }

    // ==============================
    // 2️⃣ ADMIN API ROUTES
    // ==============================
    if (url.pathname.startsWith("/admin")) {
      return handleAdminAPI(request, env)
    }

    return new Response("Not Found", { status: 404 })
  }
}


/* ===================================================== */
/* HTML DASHBOARD */
/* ===================================================== */

function renderAdminHTML() {
  return new Response(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>15D Admin</title>

    <link href="https://fonts.googleapis.com/css2?family=Lexend&family=Montserrat&display=swap" rel="stylesheet">

    <style>
      body {
        background: black;
        color: gold;
        font-family: 'Lexend', sans-serif;
        margin: 0;
      }

      .header {
        font-family: 'Montserrat', sans-serif;
        font-size: 24px;
        padding: 20px;
        border-bottom: 1px solid gold;
      }

      .card {
        background: #111;
        margin: 20px;
        padding: 20px;
        border-radius: 12px;
      }

      button {
        background: gold;
        color: black;
        border: none;
        padding: 10px;
        cursor: pointer;
      }

      pre {
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    </style>
  </head>

  <body>

    <div class="header">15D Admin Control Panel</div>

    <div class="card">
      <h3>Pending KYC</h3>
      <button onclick="loadKYC()">Load</button>
      <pre id="kyc"></pre>
    </div>

    <div class="card">
      <h3>Approve Payout</h3>
      <input id="payoutId" placeholder="Payout ID" />
      <button onclick="approvePayout()">Approve</button>
    </div>

    <script>
      async function loadKYC() {
        const res = await fetch('/admin/kyc/pending')
        const data = await res.json()
        document.getElementById('kyc').innerText = JSON.stringify(data, null, 2)
      }

      async function approvePayout() {
        const payout_id = document.getElementById('payoutId').value

        const res = await fetch('/admin/payouts/approve', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payout_id })
        })

        const data = await res.json()
        alert(JSON.stringify(data))
      }
    </script>

  </body>
  </html>
  `, {
    headers: { "Content-Type": "text/html" }
  })
}


/* ===================================================== */
/* ADMIN API WRAPPER */
/* ===================================================== */

async function handleAdminAPI(request, env) {

  const url = new URL(request.url)

  const admin = await verifyAdmin(request, env)
  if (!admin) return json({ error: "Unauthorized" }, 401)

  const ctx = { admin, env, request }

  /* ================= KYC ================= */

  if (request.method === "GET" && url.pathname === "/admin/kyc/pending") {
    return getPendingKYC(ctx)
  }

  /* ================= PAYOUT ================= */

  if (request.method === "POST" && url.pathname === "/admin/payouts/approve") {
    return approvePayout(request, ctx)
  }

  return new Response("Not Found", { status: 404 })
}


/* ===================================================== */
/* AUTH */
/* ===================================================== */

async function verifyAdmin(request, env) {

  const token = request.headers.get("authorization")
  if (!token) return false

  const res = await env.AUTH_SERVICE.fetch("https://internal/admin/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  })

  if (!res.ok) return false

  const data = await res.json()

  if (!data.admin) return false

  return {
    id: data.admin_id,
    role: data.role
  }
}


/* ===================================================== */
/* KYC */
/* ===================================================== */

async function getPendingKYC(ctx) {

  const results = await ctx.env.connectors.prepare(`
    SELECT id,email,kyc_status,created_at
    FROM connectors
    WHERE kyc_status = 'under_review'
    ORDER BY created_at DESC
  `).all()

  return json(results.results)
}


/* ===================================================== */
/* PAYOUT */
/* ===================================================== */

async function approvePayout(request, ctx) {

  const { payout_id } = await request.json()

  if (!payout_id) return json({ error: "payout_id required" }, 400)

  // 1️⃣ Update DB
  await ctx.env.connectors.prepare(`
    UPDATE payouts
    SET status = 'approved'
    WHERE id = ?
  `).bind(payout_id).run()

  // 2️⃣ Trigger payout worker
  await ctx.env.PAYOUT_SERVICE.fetch("https://internal/payout/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payout_id })
  })

  // 3️⃣ Notify
  await ctx.env.NOTIFICATION_SERVICE.fetch("https://internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "PAYOUT_APPROVED",
      payout_id
    })
  })

  // (Future switch)
  // await ctx.env.EVENT_BUS.fetch(...)

  return json({ success: true })
}


/* ===================================================== */
/* HELPERS */
/* ===================================================== */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}