#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re

with open(r'C:\PEMWEB\rms-dashboard\scripts\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the KPI Cards Renderer section
old_marker = '// --- KPI Cards Renderer ---'
if old_marker in content:
    # Replace the marker
    content = content.replace(old_marker, '// --- KPI Cards Renderer dengan Periode Filter ---')
    
    # Now replace the function renderKPICards
    # Find the old function and replace it
    old_func_pattern = """function renderKPICards(data) {
  const kpiGrid = document.querySelector('.kpi-grid');
  if (!kpiGrid) return;
  
  // Data KPI dummy jika API gagal
  const kpiDefaults = {
    totalOmzet: data?.totalOmzet || 125000000,
    margin: data?.margin || 18.5,
    stokWarning: data?.stokWarning || 4,
    transaksiPending: data?.transaksiPending || 12
  };
  
  kpiGrid.innerHTML = `"""
  
    # Cari pattern fungsi renderKPICards
    if 'function renderKPICards(data) {' in content:
        # Ganti function renderKPICards dengan yang baru
        new_func = '''function renderKPICards(data) {
  const kpiGrid = document.querySelector('.kpi-grid');
  if (!kpiGrid) return;
  
  // Dapatkan periode yang dipilih
  const period = localStorage.getItem('rms_period') || '30d';
  
  // Buat HTML filter periode
  const periodHtml = '<div class=\"period-filter\" style=\"margin-bottom: 1.5rem; padding-bottom: 1px; border-bottom: 1px solid #e2e8f0;\"><select id=\"period-filter\" style=\"padding: 0.5rem; border-radius: var(--border-radius); border: 1px solid #cbd5e0;\"><option value=\"7d\" ' + (period === '7d' ? 'selected' : '') + '>7 Hari</option><option value=\"30d\" ' + (period === '30d' ? 'selected' : '') + '>30 Hari</option><option value=\"90d\" ' + (period === '90d' ? 'selected' : '') + '>90 Hari</option><option value=\"1y\" ' + (period === '1y' ? 'selected' : '') + '>1 Tahun</option></select></div>';
  
  // Data KPI dummy jika API gagal
  const kpiDefaults = {
    totalOmzet: data?.totalOmzet || 125000000,
    margin: data?.margin || 18.5,
    stokWarning: data?.stokWarning || 4,
    transaksiPending: data?.transaksiPending || 12
  };
  
  kpiGrid.innerHTML = periodHtml + '<div class=\"kpi-card\"><div class=\"kpi-value\" id=\"kpi-total-omzet\">Rp ' + formatRupiah(kpiDefaults.totalOmzet) + '</div><div class=\"kpi-label\">Total Omzet</div><div class=\"kpi-icon\">💰</div></div><div class=\"kpi-card\"><div class=\"kpi-value\" id=\"kpi-margin\">' + kpiDefaults.margin + '%</div><div class=\"kpi-label\">Margin Rata-rata</div><div class=\"kpi-icon\">📊</div></div><div class=\"kpi-card\"><div class=\"kpi-value\" id=\"kpi-stok-warning\">' + kpiDefaults.stokWarning + '</div><div class=\"kpi-label\">Stok Warning</div><div class=\"kpi-icon\">⚠️</div></div><div class=\"kpi-card\"><div class=\"kpi-value\" id=\"kpi-transaksi-pending\">' + kpiDefaults.transaksiPending + '</div><div class=\"kpi-label\">Transaksi Pending/Sync</div><div class=\"kpi-icon\">📥</div></div>';
  
  // Atur warna option setelah element dibuat
  const periodSelect = kpiGrid.querySelector('#period-filter');
  if (periodSelect) {
    const theme = document.documentElement.getAttribute('data-theme');
    periodSelect.style.borderColor = theme === 'dark' ? '#334155' : '#cbd5e0';
    const optionColor = theme === 'dark' ? '#f1f5f9' : '#1e293b';
    for (let opt of periodSelect.options) {
      opt.style.color = optionColor;
    }
  }
}'''
        
        # Replace the function
        content = content.replace(
            "function renderKPICards(data) {\n  const kpiGrid = document.querySelector('.kpi-grid');\n  if (!kpiGrid) return;\n\n  // Data KPI dummy jika API gagal\n  const kpiDefaults = {",
            new_func
        )
        print('Replacement successful')
    else:
        print('Could not find the function pattern')
else:
    print('Marker not found')

with open(r'C:\PEMWEB\rms-dashboard\scripts\app.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('File saved successfully')