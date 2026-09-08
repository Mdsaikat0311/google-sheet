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

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Public sheet fetch failed: ${res.statusText}`);
  }
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);/);
  if (!match || !match[1]) {
    throw new Error('Invalid public sheet response format');
  }

  const data = JSON.parse(match[1]);
  if (!data.table || !data.table.rows) {
    return { orders: [], tabName: targetTab };
  }

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

  return { orders, tabName: targetTab };
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

/**
 * Update order status directly in Column J of the Google Sheet row
 */
export const updateSheetOrderStatus = async (
  spreadsheetId: string,
  accessToken: string,
  tabName: string,
  rowIndex: number,
  newStatus: string
) => {
  // Status is in Column J (col index 10)
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

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to update status in Google Sheet: ${res.statusText}`);
  }

  return res.json();
};

/**
 * Update Variant in Column H of the Google Sheet row
 */
export const updateSheetVariant = async (
  spreadsheetId: string,
  accessToken: string,
  tabName: string,
  rowIndex: number,
  newVariant: string
) => {
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to update variant in Google Sheet: ${res.statusText}`);
  }
  return res.json();
};

/**
 * Update Source in Column I of the Google Sheet row
 */
export const updateSheetSource = async (
  spreadsheetId: string,
  accessToken: string,
  tabName: string,
  rowIndex: number,
  newSource: string
) => {
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to update source in Google Sheet: ${res.statusText}`);
  }
  return res.json();
};

/**
 * Update Steadfast Courier Status and Tracking Code in Google Sheet (Columns K, L, M)
 */
export const updateSheetCourierStatus = async (
  spreadsheetId: string,
  accessToken: string,
  tabName: string,
  rowIndex: number,
  trackingCode: string,
  steadfastStatus: string,
  courierStatus: string = 'in_review'
) => {
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

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to update courier in Google Sheet: ${res.statusText}`);
  }

  return res.json();
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
