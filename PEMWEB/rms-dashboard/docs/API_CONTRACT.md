# Kontrak API yang dipakai frontend

Base URL: `window.RMS_CONFIG.apiBase` (default `http://localhost:8000/api/v1`).
Semua endpoint (kecuali login) memakai header `Authorization: Bearer <token>`.
Error: status non-2xx dengan JSON `{ "message": "..." }` (409 = konflik versi stok).
Role: `owner | admin | kasir | gudang | finance | pembeli`.

| Endpoint | Request | Response |
|---|---|---|
| POST /auth/login | `{username,password}` | `{token, user:{id,name,role}}` |
| GET /products | – | `[{id,sku,name,price,cost,minStock?,stock:[{warehouseId,quantity,version}]}]` |
| GET /stores | – | `[{id,name}]` (gudang/cabang) |
| POST /sales | `{storeId,cashierId,items:[{productId,qty,price}],subtotal,tax,total,paymentMethod,payments:[{method,amount}],timestamp}` | `{id}` |
| POST /sales/sync-batch | `{sales:[{idempotencyKey, ...sama dgn /sales}]}` | `{results:[{idempotencyKey,status:'created'\|'duplicate'\|'failed',error?}]}` |
| GET/PUT /stock/:productId/:warehouseId | PUT `{delta,currentVersion}` | 409 jika versi tidak cocok |
| POST /stock/opname | `{productId,warehouseId,physicalCount,systemCount,diffAbs,diffPercent,requiresApproval,notes?}` | `{message}` |
| POST /stock/transfer | `{productId,fromWarehouseId,toWarehouseId,quantity}` | `{message}` |
| GET /journal-entries?accountId= | – | `[{id,entryDate,reference,description,totalDebit,totalCredit,isBalanced,status}]` |
| POST /journal-entries/:id/void | `{reason}` | `{message}` (membuat reversal entry) |
| GET /accounts | – | `[{id,code,name}]` |
| GET/POST /suppliers | POST `{name,code,phone,paymentTerm}` | list supplier `{id,name,code,contactName,phone,paymentTerm}` |
| GET/POST /purchase-orders | POST `{supplierId,items:[{productId,qty,unitPrice}],idempotencyKey}` | `{id,poNumber,supplierName,status,totalAmount,createdAt,poItems}` |
| GET /purchase-orders/:id | – | PO dengan `poItems:[{productId,productName,qtyOrdered,unitPrice}]` |
| GET/POST /goods-receipts | POST `{purchaseOrderId}` | `{id,grNumber,purchaseOrderId,status,receivedAt}` |
| POST /goods-receipts/:id/confirm | `{}` | `{message}` — **server** menambah stok + jurnal (atomik) |
| POST /goods-receipts/:id/return | `{reason}` | `{message}` |
| GET /event-logs/simulator | – | `[{type,createdAt,status?,payload}]` |
| GET /dashboard/kpi?storeId&period | – | `{totalOmzet,margin,stokWarning,transaksiPending}` (lihat renderKPICards di app.js) |
| GET /dashboard/sales-trend?storeId&period | – | lihat renderSalesChart |
| GET /dashboard/top-products?storeId&limit&period | – | lihat renderTopProductsChart |

WebSocket (`window.RMS_CONFIG.wsUrl`): event `stock.updated`, `order.status`, `payment.updated`, `journal.updated`.
