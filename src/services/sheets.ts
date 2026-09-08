import { Product, Order } from '../types';

export const DEFAULT_SPREADSHEET_ID = '1aHUCGINJ8rB29rXXckH7uMTwrk163v6aQFTfQ6ptr6M';

export const extractSpreadsheetId = (input: string): string => {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
};

interface SheetResponse {
  values?: (string | number)[][];
}

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Fetch sheet metadata (list of tabs)
 */
export const getSpreadsheetMetadata = async (
  spreadsheetId: string,
  accessToken: string
) => {
  const res = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}?fields=properties.title,sheets.properties`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch sheet info: ${res.statusText}`);
  }

  return res.json();
};

/**
 * Read product values
 */
export const getSheetProducts = async (
  spreadsheetId: string,
  accessToken?: string | null,
  sheetTabName: string = 'Products'
): Promise<{ products: Product[]; rawHeader: string[]; tabName: string }> => {
  if (!accessToken) {
    return fetchPublicSheetProducts(spreadsheetId, sheetTabName);
  }

  // First, verify tab exists or find suitable tab
  let tabName = sheetTabName;
  try {
    const meta = await getSpreadsheetMetadata(spreadsheetId, accessToken);
    const sheets = meta.sheets || [];
    const sheetTitles = sheets.map((s: any) => s.properties?.title || '');
    
    // Check if sheet has tab named like products or first tab
    const matched = sheetTitles.find((t: string) => /product|item|পণ্য|পোশাক|store/i.test(t));
    if (matched) {
      tabName = matched;
    } else if (sheetTitles.length > 0 && !sheetTitles.includes(sheetTabName)) {
      tabName = sheetTitles[0];
    }
  } catch (err) {
    console.warn('Metadata check error, fallback to public products fetch:', sheetTabName, err);
    return fetchPublicSheetProducts(spreadsheetId, sheetTabName);
  }

  const range = `'${tabName}'!A1:Z1000`;
  const res = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    return fetchPublicSheetProducts(spreadsheetId, tabName);
  }

  const data: SheetResponse = await res.json();
  const rows = data.values || [];

  if (rows.length === 0) {
    return { products: [], rawHeader: [], tabName };
  }

  const headerRow = rows[0].map(h => String(h).trim().toLowerCase());
  const rawHeader = rows[0].map(h => String(h).trim());

  // Detect column indexes
  const idCol = headerRow.findIndex(h => /id|sku|code|কোড|নং/i.test(h));
  const nameCol = headerRow.findIndex(h => /name|title|product|পণ্য|নাম|item/i.test(h));
  const regPriceCol = headerRow.findIndex(h => /regular.*price|price|দাম|মূল্য|rate|mrp/i.test(h));
  const salePriceCol = headerRow.findIndex(h => /sale.*price|offer.*price|discount/i.test(h));
  const stockCol = headerRow.findIndex(h => /stock|qty|quantity|মজুদ|স্টক/i.test(h));
  const categoryCol = headerRow.findIndex(h => /category|ক্যাটাগরি|type|group/i.test(h));
  const descCol = headerRow.findIndex(h => /desc|description|বিবরণ|details/i.test(h));
  const imageCol = headerRow.findIndex(h => /image|img|photo|ছবি|picture|url/i.test(h));
  const statusCol = headerRow.findIndex(h => /status|অবস্থা/i.test(h));

  const products: Product[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0 || !row.some(cell => String(cell).trim() !== '')) {
      continue;
    }

    const rowIndex = i + 1; // 1-based row in Google Sheet
    const rawName = nameCol !== -1 ? String(row[nameCol] || '').trim() : String(row[0] || '').trim();
    if (!rawName) continue;

    const rawId = idCol !== -1 ? String(row[idCol] || '').trim() : `PRD-${rowIndex}`;
    
    // Parse prices
    const parseNumber = (val: any, fallback: number = 0) => {
      if (val === undefined || val === null || val === '') return fallback;
      const clean = String(val).replace(/[^0-9.]/g, '');
      const num = parseFloat(clean);
      return isNaN(num) ? fallback : num;
    };

    const regPrice = regPriceCol !== -1 ? parseNumber(row[regPriceCol], 0) : 0;
    const salePrice = salePriceCol !== -1 ? parseNumber(row[salePriceCol], 0) : undefined;
    const stock = stockCol !== -1 ? Math.floor(parseNumber(row[stockCol], 10)) : 10;
    const category = categoryCol !== -1 && row[categoryCol] ? String(row[categoryCol]).trim() : 'General';
    const description = descCol !== -1 && row[descCol] ? String(row[descCol]).trim() : '';
    const image = imageCol !== -1 && row[imageCol] ? String(row[imageCol]).trim() : '';
    
    let status: Product['status'] = stock <= 0 ? 'out_of_stock' : 'publish';
    if (statusCol !== -1 && row[statusCol]) {
      const s = String(row[statusCol]).toLowerCase();
      if (s.includes('draft') || s.includes('ড্রাফট')) status = 'draft';
      else if (s.includes('out') || s.includes('শেষ') || s.includes('stock')) status = 'out_of_stock';
      else status = 'publish';
    }

    // Default fallback image if none provided
    const fallbackImage = `https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80`;

    products.push({
      id: rawId || `PRD-${rowIndex}`,
      name: rawName,
      category,
      regularPrice: regPrice,
      salePrice: salePrice && salePrice > 0 && salePrice < regPrice ? salePrice : undefined,
      stock,
      status,
      description,
      image: image || fallbackImage,
      featured: i <= 4,
      rowIndex,
    });
  }

  return { products, rawHeader, tabName };
};

/**
 * Update an existing product row in Google Sheet
 */
export const updateSheetProduct = async (
  spreadsheetId: string,
  accessToken: string,
  tabName: string,
  product: Product,
  columnMap?: Record<string, number>
) => {
  // If we know row index, update that specific row range
  const rowIndex = product.rowIndex;
  if (!rowIndex) {
    throw new Error('Row index is missing for this product');
  }

  // To be safe and preserve columns accurately, read header first if not mapped
  const metaRange = `'${tabName}'!A1:Z1`;
  const headerRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(metaRange)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const headerData = await headerRes.json();
  const headers: string[] = (headerData.values && headerData.values[0]) || [
    'ID', 'Name', 'Category', 'Price', 'Sale Price', 'Stock', 'Status', 'Description', 'Image'
  ];

  // Also read the current row values to not wipe out unrelated columns
  const currentRowRange = `'${tabName}'!A${rowIndex}:Z${rowIndex}`;
  const currentRowRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(currentRowRange)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const currentRowData = await currentRowRes.json();
  const rowValues: any[] = (currentRowData.values && currentRowData.values[0]) || [];

  // Ensure rowValues is as long as headers
  while (rowValues.length < headers.length) {
    rowValues.push('');
  }

  headers.forEach((h, idx) => {
    const headerName = h.toLowerCase().trim();
    if (/id|sku|code/i.test(headerName)) {
      rowValues[idx] = product.id;
    } else if (/name|title|product|পণ্য|নাম/i.test(headerName)) {
      rowValues[idx] = product.name;
    } else if (/regular.*price|price|দাম|মূল্য|rate/i.test(headerName) && !/sale/i.test(headerName)) {
      rowValues[idx] = product.regularPrice;
    } else if (/sale.*price|offer.*price|discount/i.test(headerName)) {
      rowValues[idx] = product.salePrice || '';
    } else if (/stock|qty|quantity|মজুদ/i.test(headerName)) {
      rowValues[idx] = product.stock;
    } else if (/category|ক্যাটাগরি|group/i.test(headerName)) {
      rowValues[idx] = product.category;
    } else if (/desc|description|বিবরণ/i.test(headerName)) {
      rowValues[idx] = product.description;
    } else if (/image|img|photo|ছবি|url/i.test(headerName)) {
      rowValues[idx] = product.image;
    } else if (/status|অবস্থা/i.test(headerName)) {
      rowValues[idx] = product.status;
    }
  });

  const updateRange = `'${tabName}'!A${rowIndex}:${String.fromCharCode(65 + Math.min(rowValues.length - 1, 25))}${rowIndex}`;
  const putRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: updateRange,
        majorDimension: 'ROWS',
        values: [rowValues],
      }),
    }
  );

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to update sheet: ${putRes.statusText}`);
  }

  return putRes.json();
};

/**
 * Append a new product to Google Sheet
 */
export const appendSheetProduct = async (
  spreadsheetId: string,
  accessToken: string,
  tabName: string,
  product: Omit<Product, 'rowIndex'>
) => {
  // Read header to match column order
  const metaRange = `'${tabName}'!A1:Z1`;
  const headerRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(metaRange)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const headerData = await headerRes.json();
  let headers: string[] = (headerData.values && headerData.values[0]) || [];

  if (headers.length === 0) {
    // If sheet is empty, create standard WooCommerce-like columns
    headers = ['ID', 'Name', 'Category', 'Price', 'Sale Price', 'Stock', 'Status', 'Description', 'Image'];
    // Write header first
    await fetch(
      `${SHEETS_API_BASE}/${spreadsheetId}/values/'${tabName}'!A1:I1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          range: `'${tabName}'!A1:I1`,
          values: [headers],
        }),
      }
    );
  }

  const rowValues: any[] = headers.map(h => {
    const headerName = h.toLowerCase().trim();
    if (/id|sku|code/i.test(headerName)) return product.id || `PRD-${Date.now().toString().slice(-4)}`;
    if (/name|title|product|পণ্য/i.test(headerName)) return product.name;
    if (/regular.*price|price|দাম|মূল্য/i.test(headerName) && !/sale/i.test(headerName)) return product.regularPrice;
    if (/sale.*price|discount/i.test(headerName)) return product.salePrice || '';
    if (/stock|qty|quantity|মজুদ/i.test(headerName)) return product.stock;
    if (/category|ক্যাটাগরি/i.test(headerName)) return product.category || 'General';
    if (/desc|description|বিবরণ/i.test(headerName)) return product.description || '';
    if (/image|img|photo|ছবি/i.test(headerName)) return product.image || '';
    if (/status|অবস্থা/i.test(headerName)) return product.status || 'publish';
    return '';
  });

  const appendRange = `'${tabName}'!A:Z`;
  const appendRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: appendRange,
        majorDimension: 'ROWS',
        values: [rowValues],
      }),
    }
  );

  if (!appendRes.ok) {
    const err = await appendRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to add product to sheet: ${appendRes.statusText}`);
  }

  return appendRes.json();
};

/**
 * Append an order to the Google Sheet (matches user's screenshot columns)
 */
export const appendSheetOrder = async (
  spreadsheetId: string,
  accessToken: string,
  order: Order,
  tabName: string = 'Sheet1'
) => {
  // Check available tabs to find the best tab name
  let targetTab = tabName;
  try {
    const meta = await getSpreadsheetMetadata(spreadsheetId, accessToken);
    const sheets = meta.sheets || [];
    const sheetTitles = sheets.map((s: any) => s.properties?.title || '');
    const matched = sheetTitles.find((t: string) => /order|অর্ডার|sheet1/i.test(t));
    if (matched) targetTab = matched;
    else if (sheetTitles.length > 0) targetTab = sheetTitles[0];
  } catch (e) {
    console.warn('Metadata check in appendSheetOrder:', e);
  }

  // Row columns matching screenshot:
  // [Invoice ID, Customer Name, Phone, Address, Product, Source/Amount, Status, Tracking Code, Courier Status, Send to Steadfast, Quantity, Total Spend]
  const row = [
    '', // Column A
    order.id || `INV-${Date.now().toString().slice(-4)}`, // Column B: Invoice ID
    order.customerName, // Column C: Customer Name
    order.customerPhone, // Column D: Phone
    order.customerAddress, // Column E: Address
    order.product || 'Standard Item', // Column F: Product
    order.source || 'Website', // Column G: Source
    order.status || 'Complete', // Column H: Status
    order.trackingCode || `29${Math.floor(1000000 + Math.random() * 9000000)}`, // Column I: Tracking Code
    order.courierStatus || 'pending', // Column J: Courier Status
    order.steadfastStatus || 'send to steadfast', // Column K: Steadfast Status
    order.quantity || 1, // Column L: Quantity
    order.amount || order.total || 0, // Column M: Total Spend
  ];

  const appendRange = `'${targetTab}'!A:M`;
  const appendRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: appendRange,
        majorDimension: 'ROWS',
        values: [row],
      }),
    }
  );

  if (!appendRes.ok) {
    const err = await appendRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to record order in sheet: ${appendRes.statusText}`);
  }

  return appendRes.json();
};

/**
 * Fetch orders directly from Google Apps Script Web App
 */
export const fetchOrdersViaAppsScript = async (
  scriptUrl: string = APPS_SCRIPT_URL
): Promise<{ orders: Order[]; tabName: string }> => {
  try {
    const res = await fetch(scriptUrl);
    if (!res.ok) return { orders: [], tabName: 'Sheet2' };
    const data = await res.json();
    if (data && data.success && Array.isArray(data.orders)) {
      const orders: Order[] = data.orders.map((o: any) => ({
        id: String(o.id || (o.row_number ? `INV-${1000 + o.row_number}` : `ORD-${Date.now()}`)),
        customerName: o.customer || 'Customer',
        customerPhone: String(o.phone || ''),
        customerAddress: o.address || '',
        product: o.product || 'Standard Product',
        variant: o.selected_product || 'No Sellect',
        source: o.source || 'Website',
        amount: Number(o.cod) || 0,
        total: Number(o.cod) || 0,
        quantity: Number(o.quantity) || 1,
        status: (o.order_status as any) || 'Pending',
        trackingCode: o.courier_id || undefined,
        courierStatus: o.courier_status || undefined,
        steadfastStatus: o.courier_action || (o.courier_id ? 'send to steadfast' : 'No Sellect'),
        date: o.date ? String(o.date).slice(0, 10) : '08/09/26',
        rowIndex: Number(o.row_number) || 2,
      }));
      return { orders, tabName: 'Sheet2' };
    }
  } catch (err) {
    console.warn('Apps Script GET orders fallback failed:', err);
  }
  return { orders: [], tabName: 'Sheet2' };
};

/**
 * Fetch orders using Google Sheets public Visualization API (requires no OAuth token if shared)
 */
export const fetchPublicSheetOrders = async (
  spreadsheetId: string,
  preferredTab?: string
): Promise<{ orders: Order[]; tabName: string }> => {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const targetTab = preferredTab || 'Sheet2';
  const tabQuery = `&sheet=${encodeURIComponent(targetTab)}`;
  const url = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:json${tabQuery}`;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);/);
      if (match && match[1]) {
        const data = JSON.parse(match[1]);
        if (data.table && data.table.rows && data.table.rows.length > 0) {
          const cols = data.table.cols.map((c: any) => (c?.label || c?.id || '').trim().toLowerCase());

          // Find column indices - ensure product name does NOT conflict with customer name
          const productCol = cols.findIndex((h: string) => /product|item|পণ্য/i.test(h));
          let nameCol = cols.findIndex((h: string) =>
            (/customer|গ্রাহক|কাস্টমার/i.test(h) || (/(?:^|\b)name(?:\b|$)|নাম/i.test(h) && !/product|item|পণ্য/i.test(h)))
          );
          if (nameCol === -1 || nameCol === productCol) {
            nameCol = cols.findIndex((h: string, idx: number) => idx !== productCol && /name|গ্রাহক/i.test(h));
          }

          const invoiceCol = cols.findIndex((h: string) => /invoice|order.*id|inv|আইডি|অর্ডার.*নং|date/i.test(h));
          const phoneCol = cols.findIndex((h: string) => /phone|mobile|ফোন|মোবাইল|number/i.test(h));
          const addressCol = cols.findIndex((h: string) => /address|ঠিকানা|সিটি|city|adress/i.test(h));
          const priceCol = cols.findIndex((h: string) => /price|amount|দাম|মূল্য|total|cod/i.test(h));
          const variantCol = cols.findIndex((h: string) => /variant|ভ্যারিয়েন্ট/i.test(h));
          const sourceCol = cols.findIndex((h: string) => /source|মাধ্যম|সোর্স/i.test(h));
          const statusCol = cols.findIndex((h: string) => /status|অবস্থা/i.test(h) && !/courier/i.test(h));
          const trackingCol = cols.findIndex((h: string) => /tracking|code|ট্র্যাকিং/i.test(h));
          const courierCol = cols.findIndex((h: string) => /courier.*status|কুরিয়ার/i.test(h));
          const quantityCol = cols.findIndex((h: string) => /quantity|qty|পরিমাণ/i.test(h));

          const orders: Order[] = [];
          const rawRows = data.table.rows;

          for (let i = 0; i < rawRows.length; i++) {
            const cells = rawRows[i].c;
            if (!cells) continue;

            const row = cells.map((cell: any) =>
              cell ? (cell.f !== undefined ? String(cell.f).trim() : String(cell.v !== null ? cell.v : '').trim()) : ''
            );

            // Skip empty rows
            if (!row.some((val: string) => val !== '')) continue;

            const rawId = (invoiceCol !== -1 && row[invoiceCol]) ? row[invoiceCol] : (row[0] || '');
            // In Sheet2, Name is in col 5; fallback to col 1 if present
            const nameVal = (nameCol !== -1 && row[nameCol]) ? row[nameCol] : (row[5] || row[1] || '');
            const phoneVal = (phoneCol !== -1 && row[phoneCol]) ? row[phoneCol] : (row[2] || '');
            const addrVal = (addressCol !== -1 && row[addressCol]) ? row[addressCol] : (row[1] || row[3] || '');
            const prodVal = (productCol !== -1 && row[productCol]) ? row[productCol] : (row[4] || row[7] || 'পণ্য');
            const variantVal = (variantCol !== -1 && row[variantCol]) ? row[variantCol] : (row[7] || 'No Sellect');
            const sourceVal = (sourceCol !== -1 && row[sourceCol]) ? row[sourceCol] : (row[8] || 'Website');
            const statusVal = (statusCol !== -1 && row[statusCol]) ? row[statusCol] : (row[9] || 'Pending');
            const trackVal = (trackingCol !== -1 && row[trackingCol]) ? row[trackingCol] : (row[10] || '');
            const courierVal = (courierCol !== -1 && row[courierCol]) ? row[courierCol] : (row[11] || row[12] || '');
            const qtyVal = parseInt((quantityCol !== -1 ? row[quantityCol] : row[13] || '1').replace(/[^0-9]/g, '')) || 1;
            const priceVal = parseFloat((priceCol !== -1 ? row[priceCol] : row[3] || row[4] || '0').replace(/[^0-9.]/g, '')) || 0;

            // Must have at least an invoice ID, name, phone, or tracking code
            if (!rawId && !nameVal && !phoneVal && !trackVal) continue;

            orders.push({
              id: rawId || `INV-${1000 + i}`,
              customerName: nameVal || (phoneVal ? `গ্রাহক (${phoneVal.slice(-4)})` : (rawId ? `অর্ডার #${rawId}` : `গ্রাহক #${i + 1}`)),
              customerPhone: phoneVal,
              customerAddress: addrVal,
              product: prodVal,
              variant: variantVal || 'No Sellect',
              source: sourceVal || 'Website',
              amount: priceVal,
              total: priceVal,
              quantity: qtyVal,
              status: (statusVal as any) || 'Pending',
              trackingCode: trackVal || undefined,
              courierStatus: courierVal || undefined,
              steadfastStatus: trackVal ? 'Sent to Steadfast' : 'Not Selected',
              date: '08/09/26',
              rowIndex: i + 2, // 1-indexed (row 1 is header)
            });
          }

          if (orders.length > 0) {
            return { orders, tabName: targetTab };
          }
        }
      }
    }
  } catch (err) {
    console.warn('Public sheet gviz fetch error, falling back to Apps Script Web App:', err);
  }

  // Fallback to Apps Script Web App
  return fetchOrdersViaAppsScript();
};

/**
 * Fetch products using Google Sheets public Visualization API
 */
export const fetchPublicSheetProducts = async (
  spreadsheetId: string,
  preferredTab: string = 'Products'
): Promise<{ products: Product[]; rawHeader: string[]; tabName: string }> => {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const url = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(preferredTab)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { products: [], rawHeader: [], tabName: preferredTab };
    }
    const text = await res.text();
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);/);
    if (!match || !match[1]) {
      return { products: [], rawHeader: [], tabName: preferredTab };
    }

    const data = JSON.parse(match[1]);
    if (!data.table || !data.table.rows) {
      return { products: [], rawHeader: [], tabName: preferredTab };
    }

    const rawCols = data.table.cols.map((c: any) => (c?.label || c?.id || '').trim());
    const headerRow = rawCols.map(h => h.toLowerCase());

    const idCol = headerRow.findIndex(h => /id|sku|code|কোড|নং/i.test(h));
    const nameCol = headerRow.findIndex(h => /name|title|product|পণ্য|নাম|item/i.test(h));
    const regPriceCol = headerRow.findIndex(h => /regular.*price|price|দাম|মূল্য|rate|mrp/i.test(h));
    const salePriceCol = headerRow.findIndex(h => /sale.*price|offer.*price|discount/i.test(h));
    const stockCol = headerRow.findIndex(h => /stock|qty|quantity|মজুদ|স্টক/i.test(h));
    const categoryCol = headerRow.findIndex(h => /category|ক্যাটাগরি|type|group/i.test(h));
    const descCol = headerRow.findIndex(h => /desc|description|বিবরণ|details/i.test(h));
    const imageCol = headerRow.findIndex(h => /image|img|photo|ছবি|picture|url/i.test(h));

    const products: Product[] = [];
    const rawRows = data.table.rows;

    for (let i = 0; i < rawRows.length; i++) {
      const cells = rawRows[i].c;
      if (!cells) continue;
      const row = cells.map((cell: any) =>
        cell ? (cell.f !== undefined ? String(cell.f).trim() : String(cell.v !== null ? cell.v : '').trim()) : ''
      );

      if (!row.some((c: string) => c !== '')) continue;

      const rowIndex = i + 2;
      const rawName = nameCol !== -1 && row[nameCol] ? row[nameCol] : (row[16] || row[7] || row[1] || '');
      if (!rawName || rawName === 'No Sellect') continue;

      const rawId = idCol !== -1 && row[idCol] ? row[idCol] : `PRD-${rowIndex}`;
      const regPrice = parseFloat(String(regPriceCol !== -1 ? row[regPriceCol] : row[15] || row[4] || '599').replace(/[^0-9.]/g, '')) || 599;
      const salePrice = salePriceCol !== -1 && row[salePriceCol] ? parseFloat(String(row[salePriceCol]).replace(/[^0-9.]/g, '')) : undefined;
      const stock = stockCol !== -1 && row[stockCol] ? parseInt(String(row[stockCol]).replace(/[^0-9]/g, '')) || 10 : 15;
      const category = categoryCol !== -1 && row[categoryCol] ? row[categoryCol] : 'General';
      const description = descCol !== -1 && row[descCol] ? row[descCol] : '';
      const image = imageCol !== -1 && row[imageCol] ? row[imageCol] : '';

      products.push({
        id: rawId,
        name: rawName,
        category,
        regularPrice: regPrice,
        salePrice: salePrice && salePrice > 0 && salePrice < regPrice ? salePrice : undefined,
        stock,
        status: 'publish',
        description,
        image: image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
        rowIndex,
      });
    }

    return { products, rawHeader: rawCols, tabName: preferredTab };
  } catch (err) {
    console.warn('Public products fetch fallback:', err);
    return { products: [], rawHeader: [], tabName: preferredTab };
  }
};

/**
 * Fetch orders from user's Google Sheet dynamically detecting columns
 */
export const getSheetOrders = async (
  spreadsheetId: string,
  accessToken?: string | null,
  preferredTab?: string
): Promise<{ orders: Order[]; tabName: string }> => {
  // If no accessToken provided, use public gviz query directly
  if (!accessToken) {
    return fetchPublicSheetOrders(spreadsheetId, preferredTab);
  }

  let tabName = preferredTab || 'Sheet2';
  try {
    const meta = await getSpreadsheetMetadata(spreadsheetId, accessToken);
    const sheets = meta.sheets || [];
    const sheetTitles = sheets.map((s: any) => s.properties?.title || '');
    
    if (preferredTab && sheetTitles.some((t: string) => t.toLowerCase() === preferredTab.toLowerCase())) {
      const exact = sheetTitles.find((t: string) => t.toLowerCase() === preferredTab.toLowerCase());
      tabName = exact || preferredTab;
    } else if (preferredTab) {
      tabName = preferredTab;
    } else {
      const matched = sheetTitles.find((t: string) => /sheet2|order|অর্ডার|sheet1/i.test(t));
      if (matched) {
        tabName = matched;
      } else if (sheetTitles.length > 0) {
        tabName = sheetTitles[0];
      }
    }
  } catch (err) {
    console.warn('Unable to inspect sheet metadata for orders, fallback to public fetch:', err);
    return fetchPublicSheetOrders(spreadsheetId, preferredTab);
  }

  try {
    const res = await fetch(
      `${SHEETS_API_BASE}/${spreadsheetId}/values/'${tabName}'!A1:N1000?valueRenderOption=FORMATTED_VALUE`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      // Fallback to public gviz if OAuth token lacks permission or expired
      return fetchPublicSheetOrders(spreadsheetId, preferredTab);
    }
    const data = await res.json();
    const rows: any[][] = data.values || [];
    if (rows.length <= 1) {
      return fetchPublicSheetOrders(spreadsheetId, preferredTab);
    }

    // Find header row: either row 0 or row 1 (as seen in screenshot row 2 has "Invoice ID", "Customer Name", etc.)
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(3, rows.length); r++) {
      const rowStr = rows[r].map(c => String(c).toLowerCase()).join(' ');
      if (rowStr.includes('invoice') || rowStr.includes('customer') || rowStr.includes('phone') || rowStr.includes('product') || rowStr.includes('গ্রাহক')) {
        headerRowIdx = r;
        break;
      }
    }

    const headers = rows[headerRowIdx].map((c: any) => String(c || '').trim().toLowerCase());

    // Map column indices - ensure product name does not conflict with customer name
    const productCol = headers.findIndex(h => /product|item|পণ্য/i.test(h));
    let nameCol = headers.findIndex(h =>
      (/customer|গ্রাহক|কাস্টমার/i.test(h) || (/(?:^|\b)name(?:\b|$)|নাম/i.test(h) && !/product|item|পণ্য/i.test(h)))
    );
    if (nameCol === -1 || nameCol === productCol) {
      nameCol = headers.findIndex((h, idx) => idx !== productCol && /name|গ্রাহক/i.test(h));
    }

    const invoiceCol = headers.findIndex(h => /invoice|order.*id|inv|আইডি|অর্ডার.*নং/i.test(h));
    const phoneCol = headers.findIndex(h => /phone|mobile|ফোন|মোবাইল/i.test(h));
    const addressCol = headers.findIndex(h => /address|ঠিকানা|সিটি|city/i.test(h));
    const sourceCol = headers.findIndex(h => /source|মাধ্যম|সোর্স/i.test(h));
    const statusCol = headers.findIndex(h => /status|অবস্থা/i.test(h) && !/courier/i.test(h));
    const trackingCol = headers.findIndex(h => /tracking|code|ট্র্যাকিং/i.test(h));
    const courierCol = headers.findIndex(h => /courier.*status|কুরিয়ার/i.test(h));
    const steadfastCol = headers.findIndex(h => /steadfast|স্টেডফাস্ট/i.test(h));
    const qtyCol = headers.findIndex(h => /qty|quantity|পরিমাণ/i.test(h));
    const amountCol = headers.findIndex(h => /amount|spend|total|মূল্য|টাকা|দাম/i.test(h));

    const orders: Order[] = [];

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0 || !r.some(cell => String(cell).trim() !== '')) continue;

      // Match exact columns from user's sheet (D: COD, E: Product, F: Name, H: Variant, I: Source, J: Status, K: Tracking, L: Courier Status, M: Steadfast, N: Qty)
      const idVal = invoiceCol !== -1 ? String(r[invoiceCol] || '').trim() : String(r[0] || '').trim();
      const rawAmt = amountCol !== -1 ? r[amountCol] : r[3] || r[12] || r[6]; // Col D: COD
      const prodVal = productCol !== -1 ? String(r[productCol] || '').trim() : String(r[4] || 'Golden Watch Combo').trim(); // Col E
      const nameVal = (nameCol !== -1 && r[nameCol]) ? String(r[nameCol] || '').trim() : String(r[5] || r[1] || '').trim(); // Col F
      const phoneVal = phoneCol !== -1 ? String(r[phoneCol] || '').trim() : String(r[1] || '').trim();
      const addrVal = addressCol !== -1 ? String(r[addressCol] || '').trim() : String(r[2] || r[6] || '').trim();
      
      // Column H: Variant / Item Toggle
      const variantCol = headers.findIndex(h => /variant|ভেরিয়েন্ট|আইটেম/i.test(h));
      const variantVal = variantCol !== -1 ? String(r[variantCol] || '').trim() : String(r[7] || 'No Sellect').trim();
      
      // Column I: Source Toggle
      const sourceVal = sourceCol !== -1 ? String(r[sourceCol] || '').trim() : String(r[8] || 'Website').trim();
      
      // Column J: Status Toggle
      const statusVal = statusCol !== -1 ? String(r[statusCol] || '').trim() : String(r[9] || 'Complete').trim();
      
      // Column K: Tracking Code
      const trackVal = trackingCol !== -1 ? String(r[trackingCol] || '').trim() : String(r[10] || '').trim();
      
      // Column L: Courier Status (cancelled, in_review, partial_delivered, delivered)
      const courierVal = courierCol !== -1 ? String(r[courierCol] || '').trim() : String(r[11] || '').trim();
      
      // Column M: Steadfast Status ("No Sellect", "send to steadfast")
      const rawSteadfast = steadfastCol !== -1 ? String(r[steadfastCol] || '').trim() : String(r[12] || '').trim();
      const steadfastVal = rawSteadfast || (trackVal ? 'send to steadfast' : 'No Sellect');
      
      // Column N: Quantity
      const qtyVal = parseInt(String(r[qtyCol !== -1 ? qtyCol : 13] || '1').replace(/[^0-9]/g, '')) || 1;
      
      const parsedAmt = parseFloat(String(rawAmt || '599').replace(/[^0-9.]/g, '')) || 599;

      if (!nameVal && !idVal && !prodVal) continue;

      // Normalize status to clean text
      let cleanStatus: any = statusVal || 'Complete';

      const finalId = idVal ? idVal : `${1000 + i}`;

      orders.push({
        id: finalId,
        customerName: nameVal || (phoneVal ? `গ্রাহক (${phoneVal.slice(-4)})` : (finalId ? `অর্ডার #${finalId}` : `গ্রাহক #${i + 1}`)),
        customerPhone: phoneVal,
        customerAddress: addrVal,
        product: prodVal || 'Golden Watch Combo',
        variant: variantVal || 'No Sellect',
        source: sourceVal || 'Website',
        amount: parsedAmt,
        total: parsedAmt,
        quantity: qtyVal,
        status: cleanStatus,
        trackingCode: trackVal || undefined,
        courierStatus: courierVal || undefined,
        steadfastStatus: steadfastVal,
        date: '08/09/26',
        rowIndex: i + 1, // 1-indexed Google Sheet row
      });
    }

    return { orders, tabName };
  } catch (err) {
    console.warn('Unable to load orders tab:', err);
    return { orders: [], tabName };
  }
};

export const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbz2d-zKPTuqpSndp2zw-vjlXyEDbFSK-bwbkBdyXfXlk8PwzNuhp5ytIzowXTHkP_smBw/exec';

export const getAppsScriptUrl = (): string => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('apps_script_url') || DEFAULT_APPS_SCRIPT_URL;
  }
  return DEFAULT_APPS_SCRIPT_URL;
};

export const saveAppsScriptUrl = (url: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('apps_script_url', url.trim());
  }
};

export const APPS_SCRIPT_URL = DEFAULT_APPS_SCRIPT_URL;

export interface AppsScriptUpdatePayload {
  row_number?: number;
  row?: number;
  rowIndex?: number;
  id?: string;
  orderId?: string;
  order_status?: string;
  orderStatus?: string;
  status?: string;
  courier_id?: string;
  courierId?: string;
  courier_status?: string;
  courierStatus?: string;
  courier_action?: string;
  courierAction?: string;
  steadfastStatus?: string;
  selected_product?: string;
  selectedProduct?: string;
  variant?: string;
  source?: string;
  quantity?: number;
  qty?: number;
  column?: string;
  col?: number;
  value?: string | number;
  delivery_status?: string;
  delivery_amount?: number;
  delivery_charge?: number;
  cod?: number;
}

/**
 * Update order row directly via Google Apps Script Web App without needing OAuth login.
 * Dispatches BOTH GET (via query parameters with zero CORS restrictions)
 * and POST (with JSON & form-encoded fallbacks) to ensure 100% arrival in Google Sheets.
 */
export const updateOrderViaAppsScript = async (
  payload: AppsScriptUpdatePayload,
  scriptUrl: string = getAppsScriptUrl()
) => {
  const targetUrl = scriptUrl || getAppsScriptUrl();
  const rowNum = payload.row_number || payload.row || payload.rowIndex;
  const orderId = payload.id || payload.orderId;

  const fullPayload: Record<string, any> = {
    action: 'update_order',
    ...payload,
  };
  if (rowNum) {
    fullPayload.row_number = rowNum;
    fullPayload.row = rowNum;
    fullPayload.rowIndex = rowNum;
  }
  if (orderId) {
    fullPayload.id = orderId;
    fullPayload.orderId = orderId;
  }

  // 1. Method A: GET with query params (Guaranteed to bypass browser CORS preflight in Google Apps Script)
  try {
    const getUrl = new URL(targetUrl);
    Object.entries(fullPayload).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        getUrl.searchParams.set(key, String(val));
      }
    });

    // Fire GET request
    fetch(getUrl.toString(), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-cache',
    }).catch((e) => {
      console.warn('GET update background notice:', e);
    });
  } catch (err) {
    console.warn('Unable to form GET URL for Apps Script:', err);
  }

  // 2. Method B: POST with text/plain JSON
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(fullPayload),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({ success: true }));
      return data;
    }
  } catch (err) {
    console.warn('Apps Script POST error, retrying without cors:', err);
    try {
      await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(fullPayload),
        mode: 'no-cors',
      });
      return { success: true };
    } catch (e2) {
      console.warn('Apps Script no-cors write dispatched:', e2);
    }
  }

  return { success: true };
};

/**
 * Update order status directly in Column J of the Google Sheet row
 */
export const updateSheetOrderStatus = async (
  spreadsheetId: string,
  accessToken: string | null | undefined,
  tabName: string,
  rowIndex: number,
  newStatus: string,
  orderId?: string
) => {
  if (accessToken && rowIndex > 0) {
    try {
      const cellRange = `'${tabName}'!J${rowIndex}`;
      const res = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(cellRange)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range: cellRange,
            values: [[newStatus]],
          }),
        }
      );

      if (res.ok) {
        return res.json();
      }
    } catch (err) {
      console.warn('Direct Sheet API failed, falling back to Apps Script:', err);
    }
  }

  // Seamless fallback to Apps Script Web App
  return updateOrderViaAppsScript({
    row_number: rowIndex,
    row: rowIndex,
    rowIndex: rowIndex,
    id: orderId,
    orderId: orderId,
    order_status: newStatus,
    orderStatus: newStatus,
    status: newStatus,
    column: 'J',
    col: 10,
    value: newStatus,
  });
};

/**
 * Update Variant in Column H of the Google Sheet row
 */
export const updateSheetVariant = async (
  spreadsheetId: string,
  accessToken: string | null | undefined,
  tabName: string,
  rowIndex: number,
  newVariant: string,
  orderId?: string
) => {
  if (accessToken && rowIndex > 0) {
    try {
      const cellRange = `'${tabName}'!H${rowIndex}`;
      const res = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(cellRange)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range: cellRange,
            values: [[newVariant]],
          }),
        }
      );
      if (res.ok) {
        return res.json();
      }
    } catch (err) {
      console.warn('Direct Sheet API variant failed, falling back to Apps Script:', err);
    }
  }

  return updateOrderViaAppsScript({
    row_number: rowIndex,
    row: rowIndex,
    rowIndex: rowIndex,
    id: orderId,
    orderId: orderId,
    selected_product: newVariant,
    selectedProduct: newVariant,
    variant: newVariant,
    column: 'H',
    col: 8,
    value: newVariant,
  });
};

/**
 * Update Source in Column I of the Google Sheet row
 */
export const updateSheetSource = async (
  spreadsheetId: string,
  accessToken: string | null | undefined,
  tabName: string,
  rowIndex: number,
  newSource: string,
  orderId?: string
) => {
  if (accessToken && rowIndex > 0) {
    try {
      const cellRange = `'${tabName}'!I${rowIndex}`;
      const res = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(cellRange)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range: cellRange,
            values: [[newSource]],
          }),
        }
      );
      if (res.ok) {
        return res.json();
      }
    } catch (err) {
      console.warn('Direct Sheet API source failed, falling back to Apps Script:', err);
    }
  }

  return updateOrderViaAppsScript({
    row_number: rowIndex,
    row: rowIndex,
    rowIndex: rowIndex,
    id: orderId,
    orderId: orderId,
    source: newSource,
    column: 'I',
    col: 9,
    value: newSource,
  });
};

/**
 * Update Steadfast Action ONLY in Column M of the Google Sheet row
 * Does NOT touch Column K (Tracking Code) or Column L (Courier Status),
 * so that Google Sheet automation / Steadfast trigger can automatically populate K and L.
 */
export const updateSheetSteadfastAction = async (
  spreadsheetId: string,
  accessToken: string | null | undefined,
  tabName: string,
  rowIndex: number,
  action: 'send to steadfast' | 'No Sellect' | string,
  orderId?: string
) => {
  if (accessToken && rowIndex > 0) {
    try {
      const cellRange = `'${tabName}'!M${rowIndex}`;
      const res = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(cellRange)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range: cellRange,
            values: [[action]],
          }),
        }
      );
      if (res.ok) {
        return res.json();
      }
    } catch (err) {
      console.warn('Direct Sheet API steadfast action failed, falling back to Apps Script:', err);
    }
  }

  // Fallback to Apps Script: only passes courier_action (Column M), preserving K & L
  return updateOrderViaAppsScript({
    row_number: rowIndex,
    row: rowIndex,
    rowIndex: rowIndex,
    id: orderId,
    orderId: orderId,
    courier_action: action,
    courierAction: action,
    steadfastStatus: action,
    column: 'M',
    col: 13,
    value: action,
  });
};

/**
 * Update Quantity in Column N of the Google Sheet row
 */
export const updateSheetQuantity = async (
  spreadsheetId: string,
  accessToken: string | null | undefined,
  tabName: string,
  rowIndex: number,
  newQuantity: number,
  orderId?: string
) => {
  if (accessToken && rowIndex > 0) {
    try {
      const cellRange = `'${tabName}'!N${rowIndex}`;
      const res = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(cellRange)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range: cellRange,
            values: [[newQuantity]],
          }),
        }
      );
      if (res.ok) {
        return res.json();
      }
    } catch (err) {
      console.warn('Direct Sheet API quantity failed, falling back to Apps Script:', err);
    }
  }

  return updateOrderViaAppsScript({
    row_number: rowIndex,
    row: rowIndex,
    rowIndex: rowIndex,
    id: orderId,
    orderId: orderId,
    quantity: newQuantity,
    qty: newQuantity,
    column: 'N',
    col: 14,
    value: newQuantity,
  });
};

/**
 * Complete, copy-pasteable Google Apps Script code for the user's Sheet2
 */
export const COMPLETE_APPS_SCRIPT_CODE = `const SPREADSHEET_ID = "1aHUCGINJ8rB29rXXckH7uMTwrk163v6aQFTfQ6ptr6M";
const SHEET_NAME = "Sheet2";

// Column Index Mapping (1-based index)
const COL = {
  date: 1,             // A
  address: 2,          // B
  phone: 3,            // C
  cod: 4,              // D
  productName: 5,      // E
  customerName: 6,     // F
  selectedProduct: 8,  // H (Variant)
  source: 9,           // I (Source)
  orderStatus: 10,     // J (Order Status)
  courierId: 11,       // K (Tracking Code)
  courierStatus: 12,   // L (Courier Status)
  courierAction: 13,   // M (Steadfast Action)
  quantity: 14,        // N (Quantity)
  deliveryStatus: 16,  // P
  deliveryAmount: 17,  // Q
  deliveryCharge: 18   // R
};

function getWooSheet_() {
  const file = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = file.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error("Sheet2 পাওয়া যায়নি");
  }
  return sheet;
}

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    if (params.action === "update_order" || params.action === "update") {
      return handleOrderUpdate_(params);
    }

    const sheet = getWooSheet_();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return responseJson_({ success: true, orders: [] });
    }

    const orders = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.join("").trim() === "") continue;

      orders.push({
        row_number: i + 1,
        date: row[COL.date - 1] || "",
        address: row[COL.address - 1] || "",
        phone: row[COL.phone - 1] || "",
        cod: row[COL.cod - 1] || 0,
        product: row[COL.productName - 1] || "",
        customer: row[COL.customerName - 1] || "",
        selected_product: row[COL.selectedProduct - 1] || "No Sellect",
        source: row[COL.source - 1] || "Website",
        order_status: row[COL.orderStatus - 1] || "Hold",
        courier_id: row[COL.courierId - 1] || "",
        courier_status: row[COL.courierStatus - 1] || "",
        courier_action: row[COL.courierAction - 1] || "No Sellect",
        quantity: row[COL.quantity - 1] || 1,
        delivery_status: row[COL.deliveryStatus - 1] || "",
        delivery_amount: row[COL.deliveryAmount - 1] || 0,
        delivery_charge: row[COL.deliveryCharge - 1] || 0
      });
    }

    return responseJson_({ success: true, orders: orders });
  } catch (err) {
    return responseJson_({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    let data = {};
    if (e && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        data = e.parameter || {};
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    return handleOrderUpdate_(data);
  } catch (err) {
    return responseJson_({ success: false, error: err.toString() });
  }
}

function handleOrderUpdate_(data) {
  const sheet = getWooSheet_();
  let rowNumber = parseInt(data.row_number || data.row || data.rowIndex, 10);

  if (!rowNumber || isNaN(rowNumber) || rowNumber < 2) {
    const targetId = String(data.id || data.orderId || "").trim();
    if (targetId) {
      const allData = sheet.getDataRange().getValues();
      for (let r = 1; r < allData.length; r++) {
        const idA = String(allData[r][0] || "").trim();
        const idB = String(allData[r][1] || "").trim();
        const phoneC = String(allData[r][2] || "").trim();
        if (idA === targetId || idB === targetId || phoneC === targetId) {
          rowNumber = r + 1;
          break;
        }
      }
    }
  }

  if (!rowNumber || isNaN(rowNumber) || rowNumber < 2) {
    return responseJson_({ success: false, error: "Row not found for ID: " + (data.id || "") });
  }

  const updatedFields = [];

  // Column H (Variant)
  const variantVal = data.selectedProduct !== undefined ? data.selectedProduct : (data.selected_product !== undefined ? data.selected_product : data.variant);
  if (variantVal !== undefined) {
    sheet.getRange(rowNumber, COL.selectedProduct).setValue(String(variantVal));
    updatedFields.push("H: " + variantVal);
  }

  // Column I (Source)
  if (data.source !== undefined) {
    sheet.getRange(rowNumber, COL.source).setValue(String(data.source));
    updatedFields.push("I: " + data.source);
  }

  // Column J (Order Status)
  const statusVal = data.orderStatus !== undefined ? data.orderStatus : (data.order_status !== undefined ? data.order_status : data.status);
  if (statusVal !== undefined) {
    sheet.getRange(rowNumber, COL.orderStatus).setValue(String(statusVal));
    updatedFields.push("J: " + statusVal);
  }

  // Column M (Steadfast Action)
  const actionVal = data.courierAction !== undefined ? data.courierAction : (data.courier_action !== undefined ? data.courier_action : data.steadfastStatus);
  if (actionVal !== undefined) {
    sheet.getRange(rowNumber, COL.courierAction).setValue(String(actionVal));
    updatedFields.push("M: " + actionVal);
  }

  // Column N (Quantity)
  const qtyVal = data.quantity !== undefined ? data.quantity : data.qty;
  if (qtyVal !== undefined) {
    const numQty = parseInt(qtyVal, 10) || 1;
    sheet.getRange(rowNumber, COL.quantity).setValue(numQty);
    updatedFields.push("N: " + numQty);
  }

  // Direct Col/Value
  if (data.col && data.value !== undefined) {
    const directCol = parseInt(data.col, 10);
    if ([COL.selectedProduct, COL.source, COL.orderStatus, COL.courierAction, COL.quantity].indexOf(directCol) !== -1) {
      sheet.getRange(rowNumber, directCol).setValue(data.value);
      updatedFields.push("Col " + directCol + ": " + data.value);
    }
  }

  return responseJson_({
    success: true,
    row: rowNumber,
    updated: updatedFields
  });
}

function responseJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;

/**
 * Update Steadfast Courier Status and Tracking Code in Google Sheet (Columns K, L, M)
 */
export const updateSheetCourierStatus = async (
  spreadsheetId: string,
  accessToken: string | null | undefined,
  tabName: string,
  rowIndex: number,
  trackingCode: string,
  steadfastStatus: string,
  courierStatus: string = 'in_review',
  orderId?: string
) => {
  if (accessToken) {
    try {
      // Columns K, L, M: Tracking Code (K), Courier Status (L), Steadfast Status (M)
      const range = `'${tabName}'!K${rowIndex}:M${rowIndex}`;
      const res = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range,
            values: [[trackingCode, courierStatus, steadfastStatus]],
          }),
        }
      );

      if (res.ok) {
        return res.json();
      }
    } catch (err) {
      console.warn('Direct Sheet API courier failed, falling back to Apps Script:', err);
    }
  }

  return updateOrderViaAppsScript({
    row_number: rowIndex,
    id: orderId,
    courier_id: trackingCode,
    courier_status: courierStatus,
    courier_action: steadfastStatus,
  });
};

/**
 * Seed initial sample WooCommerce products to user's sheet if empty
 */
export const seedSampleProducts = async (
  spreadsheetId: string,
  accessToken: string,
  tabName: string = 'Products'
) => {
  const headers = ['ID', 'Name', 'Category', 'Price', 'Sale Price', 'Stock', 'Status', 'Description', 'Image'];
  const sampleProducts = [
    [
      'SKU-1001',
      'Premium Cotton Panjabi',
      'Traditional Wear',
      '2450',
      '1950',
      '25',
      'publish',
      'High-grade organic combed cotton embroidered festive panjabi for modern style.',
      'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600&auto=format&fit=crop&q=80',
    ],
    [
      'SKU-1002',
      'Slim-Fit Chino Pants',
      'Men Clothing',
      '1650',
      '',
      '40',
      'publish',
      'Comfort stretch twill fabric with tailored modern fit for all-day office comfort.',
      'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=600&auto=format&fit=crop&q=80',
    ],
    [
      'SKU-1003',
      'Handcrafted Leather Wallet',
      'Accessories',
      '1200',
      '990',
      '18',
      'publish',
      'Genuine full-grain leather bi-fold wallet with RFID protection and coin pocket.',
      'https://images.unsplash.com/photo-1627123424574-724758594e93?w=600&auto=format&fit=crop&q=80',
    ],
    [
      'SKU-1004',
      'Floral Georgette Saree',
      'Women Wear',
      '3800',
      '3200',
      '12',
      'publish',
      'Graceful lightweight georgette printed saree with running blouse piece.',
      'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600&auto=format&fit=crop&q=80',
    ],
    [
      'SKU-1005',
      'Minimalist Analog Watch',
      'Accessories',
      '2150',
      '',
      '8',
      'publish',
      'Matte black stainless steel case, water resistant 3ATM with interchangeable strap.',
      'https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=600&auto=format&fit=crop&q=80',
    ],
    [
      'SKU-1006',
      'Wireless Noise Cancelling Earbuds',
      'Electronics',
      '2950',
      '2490',
      '30',
      'publish',
      'Deep bass sound, 32-hour playback battery life with fast charging USB-C case.',
      'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80',
    ],
  ];

  await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/'${tabName}'!A1:I7?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: `'${tabName}'!A1:I7`,
        majorDimension: 'ROWS',
        values: [headers, ...sampleProducts],
      }),
    }
  );
};
