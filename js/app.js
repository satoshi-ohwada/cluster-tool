/**
 * 簡易クラスタ分析ツール - メインアプリケーション制御
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- アプリケーション状態 (State) ---
    const state = {
        sampleNames: [],
        featureNames: [],
        rawDataMatrix: [],
        selectedFeatureIndices: [],
        transformMode: 'std',
        linkageMethod: 'ward',
        distanceMetric: 'euclidean',
        currentK: 3,
        orientation: 'vertical',
        previewLimit: 15,
        excludeOutliers: false,
        originalRawDataMatrix: [],
        originalSampleNames: [],
        
        // 分析結果キャッシュ
        preprocessed: null,       // { normalized, stats }
        clusteringResult: null,   // { root, mergeHistory, nodes, N }
        assignments: [],          // [0..N-1] -> clusterId
        clusters: [],             // [{ id, samples, root }]
        silhouetteInfo: null,     // { meanScore, sampleScores }
        recommendInfo: null       // { recommendedK, silhouetteScores, reason }
    };

    // --- ユーティリティ ---
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { toast.remove(); }, 3000);
    }

    function showDataWarning(message) {
        const container = document.getElementById('data-quality-warnings');
        if (!container) return;
        container.classList.remove('hidden');
        container.innerHTML += `<div class="data-warning"><span class="data-warning-icon">⚠️</span><span>${message}</span></div>`;
    }

    function clearDataWarnings() {
        const container = document.getElementById('data-quality-warnings');
        if (container) {
            container.innerHTML = '';
            container.classList.add('hidden');
        }
    }

    // クラスタ自動命名生成 (4-1)
    function generateClusterLabel(cluster, activeFeatureNames, overallMeans) {
        const count = cluster.samples.length;
        const diffs = activeFeatureNames.map((fName, fIdx) => {
            const sum = cluster.samples.reduce((s, sIdx) => s + state.rawDataMatrix[sIdx][state.selectedFeatureIndices[fIdx]], 0);
            const mean = sum / count;
            const overallM = overallMeans[fIdx];
            const pct = overallM !== 0 ? ((mean - overallM) / Math.abs(overallM)) * 100 : 0;
            return { fName, pct };
        });
        diffs.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
        
        const top1 = diffs[0];
        const top2 = diffs[1];
        
        if (!top1 || Math.abs(top1.pct) < 10) return '標準型';
        
        const desc1 = top1.pct > 0 ? `高${top1.fName}` : `低${top1.fName}`;
        if (top2 && Math.abs(top2.pct) > 10) {
            const desc2 = top2.pct > 0 ? `高${top2.fName}` : `低${top2.fName}`;
            return `${desc1}・${desc2}型`;
        }
        return `${desc1}型`;
    }

    // --- DOM要素の参照 ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const pasteInput = document.getElementById('paste-input');
    const btnParsePaste = document.getElementById('btn-parse-paste');
    const btnSampleCity = document.getElementById('btn-sample-city');
    const btnSampleCust = document.getElementById('btn-sample-cust');
    
    const previewContainer = document.getElementById('preview-container');
    const dataSummaryBadge = document.getElementById('data-summary-badge');
    const transformModeSelect = document.getElementById('transform-mode');
    const previewTable = document.getElementById('preview-table');
    
    const analysisSection = document.getElementById('analysis-section');
    const linkageMethodSelect = document.getElementById('linkage-method');
    const distanceMetricSelect = document.getElementById('distance-metric');
    
    const recommendCard = document.getElementById('recommend-card');
    const recommendText = document.getElementById('recommend-text');
    const btnApplyRecommend = document.getElementById('btn-apply-recommend');
    const recKVal = document.getElementById('rec-k-val');
    
    const kSlider = document.getElementById('k-slider');
    const kSliderVal = document.getElementById('k-slider-val');
    const btnToggleOrientation = document.getElementById('btn-toggle-orientation');
    const btnDownloadSvg = document.getElementById('btn-download-svg');
    const dendrogramContainer = document.getElementById('dendrogram-container');
    
    const resultsSection = document.getElementById('results-section');
    const clusterSummaryTable = document.getElementById('cluster-summary-table');
    const sampleTable = document.getElementById('sample-table');
    const sampleSearchInput = document.getElementById('sample-search');
    const sampleCountBadge = document.getElementById('sample-count-badge');
    
    const exportSection = document.getElementById('export-section');
    const btnExportExcel = document.getElementById('btn-export-excel');
    const btnExportCsv = document.getElementById('btn-export-csv');

    // --- イベントリスナー設定 ---
    initEventListeners();

    function initEventListeners() {
        // ドラッグ＆ドロップ
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleFile(e.dataTransfer.files[0]);
            }
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        });

        // 貼り付けデータの読み込み
        btnParsePaste.addEventListener('click', parsePastedText);

        // サンプルデータボタン
        btnSampleCity.addEventListener('click', () => loadSampleData(window.SampleDatasets.cityLifestyle));
        btnSampleCust.addEventListener('click', () => loadSampleData(window.SampleDatasets.customerSegmentation));

        // 設定変更リスナー
        transformModeSelect.addEventListener('change', (e) => {
            state.transformMode = e.target.value;
            runPipeline();
        });
        linkageMethodSelect.addEventListener('change', (e) => {
            state.linkageMethod = e.target.value;
            runPipeline();
        });
        distanceMetricSelect.addEventListener('change', (e) => {
            state.distanceMetric = e.target.value;
            runPipeline();
        });

        // kスライダー
        kSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            state.currentK = val;
            kSliderVal.textContent = val;
            updateClusterCut();
        });

        // 自動推奨適用ボタン
        btnApplyRecommend.addEventListener('click', () => {
            if (state.recommendInfo && state.recommendInfo.recommendedK) {
                state.currentK = state.recommendInfo.recommendedK;
                kSlider.value = state.currentK;
                kSliderVal.textContent = state.currentK;
                updateClusterCut();
            }
        });

        // デンドログラム縦横切り替え
        btnToggleOrientation.addEventListener('click', () => {
            state.orientation = state.orientation === 'vertical' ? 'horizontal' : 'vertical';
            renderDendrogramView();
        });

        // SVGダウンロード
        btnDownloadSvg.addEventListener('click', downloadDendrogramSvg);

        // サンプル検索
        sampleSearchInput.addEventListener('input', renderSampleTable);

        // エクスポートボタン
        btnExportExcel.addEventListener('click', exportToExcel);
        btnExportCsv.addEventListener('click', exportToCsv);

        // (5-1) PNGダウンロード
        const btnDownloadPng = document.getElementById('btn-download-png');
        if (btnDownloadPng) btnDownloadPng.addEventListener('click', downloadDendrogramPng);

        // (5-2) チャート画像保存
        document.querySelectorAll('.btn-chart-save').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const chartId = e.target.dataset.chart;
                if (chartId) downloadChartImage(chartId);
            });
        });

        // 外れ値除外トグル
        const chkExcludeOutliers = document.getElementById('exclude-outliers');
        if (chkExcludeOutliers) {
            chkExcludeOutliers.addEventListener('change', (e) => {
                state.excludeOutliers = e.target.checked;
                applyDataFilters();
                renderPreviewTable();
                runPipeline();
                if (state.excludeOutliers) {
                    showToast('外れ値を除外して再分析しました', 'success');
                } else {
                    showToast('外れ値を含めて再分析しました', 'info');
                }
            });
        }
    }

    // --- ファイル読み込み処理 ---
    function handleFile(file) {
        const fileName = file.name.toLowerCase();
        if (fileName.endsWith('.csv')) {
            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    processRawRows(results.data);
                }
            });
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                processRawRows(jsonRows);
            };
            reader.readAsArrayBuffer(file);
        }
    }

    // --- コピペ処理 ---
    function parsePastedText() {
        const text = pasteInput.value.trim();
        if (!text) {
            alert('コピーしたデータを貼り付けてください。');
            return;
        }
        const lines = text.split(/\r?\n/).map(line => line.split('\t'));
        processRawRows(lines);
    }

    // --- サンプルデータ読み込み ---
    function loadSampleData(dataset) {
        const rows = [dataset.headers, ...dataset.data];
        processRawRows(rows);
    }

    // --- 行データのパースとデータ構造構築 ---
    function processRawRows(rawRows) {
        clearDataWarnings();

        if (!rawRows || rawRows.length < 2) {
            alert('データが少なすぎるか、形式が不正です。\nヘッダー行と少なくとも1行の数値データが必要です。');
            return;
        }

        const headerRow = rawRows[0].map(h => (h !== undefined && h !== null ? String(h).trim() : ''));
        
        state.featureNames = headerRow.slice(1);
        state.sampleNames = [];
        state.rawDataMatrix = [];

        // 欠損値・非数値セルの検出カウンター
        const nanCountPerCol = new Array(state.featureNames.length).fill(0);
        const emptyCountPerCol = new Array(state.featureNames.length).fill(0);

        for (let i = 1; i < rawRows.length; i++) {
            const row = rawRows[i];
            if (!row || row.length < 2) continue;

            const sName = row[0] !== undefined && row[0] !== null && String(row[0]).trim() !== ''
                ? String(row[0]).trim()
                : `Sample ${i}`;

            const numRow = [];
            for (let j = 1; j < row.length && j <= state.featureNames.length; j++) {
                const rawVal = row[j];
                const colIdx = j - 1;
                if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
                    emptyCountPerCol[colIdx]++;
                    numRow.push(NaN);
                } else {
                    const val = parseFloat(rawVal);
                    if (isNaN(val)) {
                        nanCountPerCol[colIdx]++;
                        numRow.push(NaN);
                    } else {
                        numRow.push(val);
                    }
                }
            }

            // 列数がヘッダーより短い場合、欠損として埋める
            while (numRow.length < state.featureNames.length) {
                emptyCountPerCol[numRow.length]++;
                numRow.push(NaN);
            }

            if (numRow.length > 0) {
                state.sampleNames.push(sName);
                state.rawDataMatrix.push(numRow);
            }
        }

        // (1-3) データ件数・変数数のバリデーション
        if (state.sampleNames.length < 3) {
            alert(`クラスタ分析には少なくとも3件以上のデータが必要です。\n現在のデータ件数: ${state.sampleNames.length}件`);
            return;
        }
        if (state.featureNames.length < 2) {
            alert(`クラスタ分析には少なくとも2つ以上の数値変数（列）が必要です。\n現在の変数数: ${state.featureNames.length}列`);
            return;
        }

        // (1-1) 非数値セルの警告
        const nonNumericCols = [];
        nanCountPerCol.forEach((cnt, idx) => {
            if (cnt > 0) nonNumericCols.push({ name: state.featureNames[idx], count: cnt, idx });
        });
        if (nonNumericCols.length > 0) {
            const msgs = nonNumericCols.map(c => `「${c.name}」に数値に変換できないデータが ${c.count} 件あります`);
            showDataWarning(msgs.join('。') + '。該当セルは 0 として処理されます。必要に応じてこの列のチェックを外してください。');
        }

        // (6-3) 欠損値の警告
        const emptyCols = [];
        emptyCountPerCol.forEach((cnt, idx) => {
            if (cnt > 0) emptyCols.push({ name: state.featureNames[idx], count: cnt, idx });
        });
        if (emptyCols.length > 0) {
            const msgs = emptyCols.map(c => `「${c.name}」に空白セルが ${c.count} 件あります`);
            showDataWarning(msgs.join('。') + '。空白セルは 0 として補完されます。');
        }

        // NaN を 0 で補完 (6-3 デフォルト動作)
        for (let i = 0; i < state.rawDataMatrix.length; i++) {
            for (let j = 0; j < state.rawDataMatrix[i].length; j++) {
                if (isNaN(state.rawDataMatrix[i][j])) {
                    state.rawDataMatrix[i][j] = 0;
                }
            }
        }

        // 初期選択変数は全列
        state.selectedFeatureIndices = state.featureNames.map((_, idx) => idx);

        // (1-2) 分散ゼロ列の自動除外
        const zeroVarianceCols = [];
        state.selectedFeatureIndices = state.selectedFeatureIndices.filter(idx => {
            const values = state.rawDataMatrix.map(row => row[idx]);
            const unique = new Set(values);
            if (unique.size <= 1) {
                zeroVarianceCols.push(state.featureNames[idx]);
                return false;
            }
            return true;
        });
        if (zeroVarianceCols.length > 0) {
            showDataWarning(`列「${zeroVarianceCols.join('、')}」は全サンプルで同一の値のため、分析から自動的に除外しました。`);
        }

        // (1-3) 選択変数数再チェック
        if (state.selectedFeatureIndices.length < 2) {
            alert(`分析可能な数値変数が 2 列未満です。\nデータの内容を確認してください。`);
            return;
        }

        // --- ここでクレンジング済みデータをオリジナルとして保存 ---
        state.originalSampleNames = [...state.sampleNames];
        state.originalRawDataMatrix = state.rawDataMatrix.map(r => [...r]);
        
        // UI表示の切り替え
        previewContainer.classList.remove('hidden');
        analysisSection.classList.remove('hidden');
        resultsSection.classList.remove('hidden');
        exportSection.classList.remove('hidden');

        // (3-3) ナビゲーション表示
        const sectionNav = document.getElementById('section-nav');
        if (sectionNav) sectionNav.classList.remove('hidden');

        // (8-5) タイトル動的更新
        document.title = `簡易クラスタ分析ツール — ${state.sampleNames.length}件×${state.featureNames.length}変数`;

        // (6-1) 変数間相関チェック
        checkHighCorrelation();

        // (6-2) 外れ値検出
        checkOutliers();

        applyDataFilters();
        renderPreviewTable();
        runPipeline();
        showToast(`✅ ${state.sampleNames.length}件 × ${state.selectedFeatureIndices.length}変数のデータを読み込みました`, 'success');
    }

    // --- (6-1) 変数間高相関チェック ---
    function checkHighCorrelation() {
        const indices = state.selectedFeatureIndices;
        const N = state.rawDataMatrix.length;
        if (N < 3 || indices.length < 2) return;

        for (let a = 0; a < indices.length; a++) {
            for (let b = a + 1; b < indices.length; b++) {
                const idxA = indices[a], idxB = indices[b];
                const valsA = state.rawDataMatrix.map(r => r[idxA]);
                const valsB = state.rawDataMatrix.map(r => r[idxB]);
                const meanA = valsA.reduce((s, v) => s + v, 0) / N;
                const meanB = valsB.reduce((s, v) => s + v, 0) / N;
                let cov = 0, varA = 0, varB = 0;
                for (let i = 0; i < N; i++) {
                    const dA = valsA[i] - meanA, dB = valsB[i] - meanB;
                    cov += dA * dB;
                    varA += dA * dA;
                    varB += dB * dB;
                }
                const r = (varA > 0 && varB > 0) ? cov / Math.sqrt(varA * varB) : 0;
                if (Math.abs(r) > 0.95) {
                    showDataWarning(`「${state.featureNames[idxA]}」と「${state.featureNames[idxB]}」は非常に似た情報を含んでいます（相関係数 r=${r.toFixed(2)}）。片方を除外すると結果が改善する場合があります。`);
                }
            }
        }
    }

    // --- (6-2) 外れ値検出 ---
    function checkOutliers() {
        const indices = state.selectedFeatureIndices;
        const N = state.rawDataMatrix.length;
        if (N < 5) return;

        indices.forEach(fIdx => {
            const values = state.rawDataMatrix.map(r => r[fIdx]);
            const mean = values.reduce((s, v) => s + v, 0) / N;
            const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (N - 1));
            if (stdDev === 0) return;

            const outlierSamples = [];
            values.forEach((v, i) => {
                const z = Math.abs((v - mean) / stdDev);
                if (z > 3) outlierSamples.push(state.sampleNames[i]);
            });

            if (outlierSamples.length > 0) {
                showDataWarning(`「${state.featureNames[fIdx]}」に極端な値（外れ値）が ${outlierSamples.length} 件あります（${outlierSamples.slice(0, 3).join('、')}${outlierSamples.length > 3 ? ' 他' : ''}）。結果に影響する可能性があります。`);
            }
        });
    }

    // --- データフィルタリング ---
    function applyDataFilters() {
        if (!state.originalRawDataMatrix || state.originalRawDataMatrix.length === 0) return;
        
        state.sampleNames = [...state.originalSampleNames];
        state.rawDataMatrix = state.originalRawDataMatrix.map(r => [...r]);

        if (state.excludeOutliers) {
            const indices = state.selectedFeatureIndices;
            const N = state.rawDataMatrix.length;
            const outlierIndices = new Set();
            
            indices.forEach(fIdx => {
                const values = state.rawDataMatrix.map(r => r[fIdx]);
                const mean = values.reduce((s, v) => s + v, 0) / N;
                const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (N - 1));
                if (stdDev === 0) return;

                values.forEach((v, i) => {
                    const z = Math.abs((v - mean) / stdDev);
                    if (z > 3) outlierIndices.add(i);
                });
            });

            if (outlierIndices.size > 0) {
                const keepIndices = [];
                for(let i = 0; i < N; i++) if(!outlierIndices.has(i)) keepIndices.push(i);
                state.rawDataMatrix = keepIndices.map(i => state.rawDataMatrix[i]);
                state.sampleNames = keepIndices.map(i => state.sampleNames[i]);
            }
        }
    }

    // --- プレビューテーブルの描画 ---
    function renderPreviewTable() {
        dataSummaryBadge.textContent = `${state.sampleNames.length} サンプル × ${state.featureNames.length} 変数`;

        // Thead
        let theadHtml = '<tr><th style="width: 40px; text-align: center;" title="チェックを外すとこの変数をクラスタ分析に使用しません">使用</th><th>サンプル名</th>';
        state.featureNames.forEach((fName, idx) => {
            const isChecked = state.selectedFeatureIndices.includes(idx);
            theadHtml += `
                <th style="text-align: right;">
                    <label style="cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;">
                        <input type="checkbox" class="feature-checkbox" data-index="${idx}" ${isChecked ? 'checked' : ''}>
                        ${fName}
                    </label>
                </th>`;
        });
        theadHtml += '</tr>';
        previewTable.querySelector('thead').innerHTML = theadHtml;

        // Tbody (先頭 15 件を表示)
        let tbodyHtml = '';
        const limit = Math.min(state.previewLimit || 15, state.sampleNames.length);
        for (let i = 0; i < limit; i++) {
            tbodyHtml += `<tr><td style="text-align: center; color: var(--text-muted);">${i + 1}</td><td style="font-weight: 600;">${state.sampleNames[i]}</td>`;
            state.featureNames.forEach((_, j) => {
                const val = state.rawDataMatrix[i][j];
                tbodyHtml += `<td style="text-align: right;">${typeof val === 'number' ? val.toLocaleString() : val}</td>`;
            });
            tbodyHtml += '</tr>';
        }
        if (state.sampleNames.length > limit) {
            const remaining = state.sampleNames.length - limit;
            tbodyHtml += `<tr><td colspan="${state.featureNames.length + 2}" style="text-align: center; color: var(--text-muted); font-style: italic; background: #fafafa;">... 他 ${remaining} 件のサンプルは省略されています <button onclick="window._expandPreview()" style="margin-left: 0.5rem; font-size: 0.82rem; color: #4f46e5; background: none; border: 1px solid #4f46e5; border-radius: 4px; padding: 0.15rem 0.6rem; cursor: pointer;">▼ さらに表示</button></td></tr>`;
        }
        previewTable.querySelector('tbody').innerHTML = tbodyHtml;

        // チェックボックスイベントバインド
        previewTable.querySelectorAll('.feature-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const fIdx = parseInt(e.target.dataset.index, 10);
                if (e.target.checked) {
                    if (!state.selectedFeatureIndices.includes(fIdx)) state.selectedFeatureIndices.push(fIdx);
                } else {
                    state.selectedFeatureIndices = state.selectedFeatureIndices.filter(idx => idx !== fIdx);
                }
                state.selectedFeatureIndices.sort((a, b) => a - b);
                applyDataFilters();
                renderPreviewTable();
                runPipeline();
            });
        });
    }

    // (3-4) プレビュー拡張
    window._expandPreview = function() {
        state.previewLimit = (state.previewLimit || 15) + 20;
        renderPreviewTable();
    };

    // --- メイン分析パイプラインの実行 ---
    function runPipeline() {
        // (7-1) 大規模データ警告
        if (state.rawDataMatrix.length > 200) {
            showToast('データ件数が多いため分析に数秒かかる場合があります...', 'warning');
        }
        
        if (state.rawDataMatrix.length === 0 || state.selectedFeatureIndices.length === 0) return;

        // 1. 選択された変数のみを抽出した部分行列
        const activeMatrix = state.rawDataMatrix.map(row => 
            state.selectedFeatureIndices.map(fIdx => row[fIdx])
        );

        // 2. 前処理 (標準化 / 正規化)
        state.preprocessed = window.ClusterEngine.preprocessData(activeMatrix, state.transformMode);

        // 3. 階層クラスタリングの実行
        state.clusteringResult = window.ClusterEngine.performHierarchicalClustering(
            state.preprocessed.normalized,
            state.linkageMethod,
            state.distanceMetric
        );

        // 4. 自動推奨 K の計算
        state.recommendInfo = window.ClusterEngine.recommendOptimalK(
            state.clusteringResult.root,
            state.preprocessed.normalized
        );

        // 推奨カードの更新
        recommendText.innerHTML = state.recommendInfo.reason;

        // (2-3) 用語平易化
        recommendText.innerHTML = recommendText.innerHTML.replace('シルエット係数', '分類の整合性スコア（シルエット係数）');

        // (4-3) シルエットスコアゲージ
        const silScore = state.recommendInfo.maxSilhouette || 0;
        const silPct = Math.max(0, Math.min(100, silScore * 100));
        let silColor = '#ef4444'; // red
        let silLabel = '境界が曖昧';
        if (silScore > 0.5) { silColor = '#10b981'; silLabel = '非常に綺麗に分かれている'; }
        else if (silScore > 0.25) { silColor = '#f59e0b'; silLabel = 'ある程度分かれている'; }

        recommendText.innerHTML += `
            <div class="silhouette-gauge">
                <span style="font-size: 0.82rem; color: #64748b;">分類の整合性:</span>
                <div class="silhouette-gauge-bar">
                    <div class="silhouette-gauge-fill" style="width: ${silPct}%; background-color: ${silColor};"></div>
                </div>
                <span class="silhouette-gauge-label" style="color: ${silColor};">${silScore.toFixed(2)} - ${silLabel}</span>
            </div>`;

        recKVal.textContent = state.recommendInfo.recommendedK;

        // kスライダー範囲調整
        const maxK = Math.min(10, state.sampleNames.length - 1);
        kSlider.max = Math.max(2, maxK);
        if (state.currentK > maxK) {
            state.currentK = state.recommendInfo.recommendedK;
            kSlider.value = state.currentK;
            kSliderVal.textContent = state.currentK;
        }

        // 5. クラスタ切断 & UI可視化更新
        updateClusterCut();
    }

    // --- クラスタ数 k に応じた切断と全グラフ・テーブルの連動更新 ---
    function updateClusterCut() {
        if (!state.clusteringResult || !state.clusteringResult.root) return;

        const N = state.sampleNames.length;
        
        // ツリーの切断
        const { assignments, clusters } = window.ClusterEngine.cutTree(
            state.clusteringResult.root,
            state.currentK,
            N
        );

        state.assignments = assignments;
        state.clusters = clusters;

        // シルエットスコア計算
        state.silhouetteInfo = window.ClusterEngine.calculateSilhouetteScore(
            state.preprocessed.normalized,
            assignments,
            state.currentK
        );

        // 各可視化コンポーネントの再描画
        renderDendrogramView();
        renderSummaryTable();
        renderRadarChart();
        renderPcaScatterMap();
        renderSampleTable();

        // 各グラフの文章解説（ナラティブ）生成
        renderNarratives();

        showToast('✅ 分析結果が更新されました', 'success');

        // (7-2) N>100件時の横表示推奨
        if (state.sampleNames.length > 100 && state.orientation === 'vertical') {
            showToast('💡 データが100件を超えています。横向き表示が推奨です', 'info');
        }
    }

    // --- デンドログラム描画 ---
    function renderDendrogramView() {
        window.DendrogramRenderer.render(
            dendrogramContainer,
            state.clusteringResult,
            state.sampleNames,
            state.currentK,
            state.assignments,
            {
                orientation: state.orientation,
                onSelectK: (newK) => {
                    state.currentK = newK;
                    kSlider.value = newK;
                    kSliderVal.textContent = newK;
                    updateClusterCut();
                }
            }
        );
    }

    // --- クラスタ要約統計テーブル描画 ---
    function renderSummaryTable() {
        const activeFeatureNames = state.selectedFeatureIndices.map(i => state.featureNames[i]);
        const k = state.clusters.length;
        const N = state.sampleNames.length;

        // 全体平均の算出
        const overallMeans = activeFeatureNames.map((_, fIdx) => {
            const sum = state.rawDataMatrix.reduce((s, row) => s + row[state.selectedFeatureIndices[fIdx]], 0);
            return sum / N;
        });

        // (4-1) クラスタ自動命名ラベルの生成
        const clusterLabels = {};
        state.clusters.forEach(cluster => {
            clusterLabels[cluster.id] = generateClusterLabel(cluster, activeFeatureNames, overallMeans);
        });
        state.clusterLabels = clusterLabels;

        // Thead
        let theadHtml = `<tr><th>クラスタID</th><th>件数 (構成比)</th>`;
        activeFeatureNames.forEach(fName => {
            theadHtml += `<th style="text-align: right;">${fName}</th>`;
        });
        theadHtml += '</tr>';
        clusterSummaryTable.querySelector('thead').innerHTML = theadHtml;

        // Tbody
        let tbodyHtml = '';
        state.clusters.forEach(cluster => {
            const cColor = window.DendrogramRenderer.getClusterColor(cluster.id);
            const count = cluster.samples.length;
            const ratio = ((count / N) * 100).toFixed(1);

            // このクラスタの各変数平均
            const clusterMeans = activeFeatureNames.map((_, fIdx) => {
                const sum = cluster.samples.reduce((s, sIdx) => s + state.rawDataMatrix[sIdx][state.selectedFeatureIndices[fIdx]], 0);
                return sum / count;
            });

            tbodyHtml += `<tr>
                <td style="font-weight: 700; color: ${cColor}; display: flex; align-items: center; gap: 0.4rem;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${cColor};"></span>
                    クラスタ ${cluster.id} <span class="cluster-auto-label" style="background-color: ${cColor}15; color: ${cColor};">${clusterLabels[cluster.id]}</span>
                </td>
                <td><b>${count}</b> 件 (${ratio}%) <button class="cluster-members-toggle" onclick="this.nextElementSibling.classList.toggle('hidden')">▶ メンバー一覧</button><div class="cluster-members-list hidden">${cluster.samples.map(sIdx => state.sampleNames[sIdx]).join('、')}</div></td>`;

            clusterMeans.forEach((mVal, fIdx) => {
                const overallM = overallMeans[fIdx];
                const diffPct = overallM !== 0 ? ((mVal - overallM) / Math.abs(overallM)) * 100 : 0;
                
                let bgStyle = '';
                if (diffPct > 15) {
                    bgStyle = 'background-color: #dbeafe; color: #1e40af; font-weight: 600;'; // 高い（青）
                } else if (diffPct < -15) {
                    bgStyle = 'background-color: #fee2e2; color: #991b1b;'; // 低い（赤）
                }

                tbodyHtml += `<td style="text-align: right; ${bgStyle}">${mVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>`;
            });

            tbodyHtml += '</tr>';
        });

        // 全体平均行
        tbodyHtml += `<tr style="font-weight: 700; background-color: #f1f5f9;">
            <td>全体平均</td>
            <td>${N} 件 (100%)</td>`;
        overallMeans.forEach(oVal => {
            tbodyHtml += `<td style="text-align: right;">${oVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>`;
        });
        tbodyHtml += '</tr>';

        clusterSummaryTable.querySelector('tbody').innerHTML = tbodyHtml;

        // (4-2) クラスタ構成比パイチャート
        const pieLabels = state.clusters.map(c => `クラスタ ${c.id}`);
        const pieValues = state.clusters.map(c => c.samples.length);
        const pieColors = state.clusters.map(c => window.DendrogramRenderer.getClusterColor(c.id));
        const pieChart = document.getElementById('cluster-pie-chart');
        if (pieChart) {
            Plotly.newPlot('cluster-pie-chart', [{
                type: 'pie',
                labels: pieLabels,
                values: pieValues,
                marker: { colors: pieColors },
                textinfo: 'label+percent',
                textfont: { size: 11 },
                hole: 0.35
            }], {
                margin: { t: 20, r: 30, b: 20, l: 30 },
                showlegend: false
            }, { responsive: true, displayModeBar: false });
        }
    }

    // --- レーダーチャート描画 ---
    function renderRadarChart() {
        const activeFeatureNames = state.selectedFeatureIndices.map(i => state.featureNames[i]);
        const traces = [];

        state.clusters.forEach(cluster => {
            const cColor = window.DendrogramRenderer.getClusterColor(cluster.id);
            
            // 各クラスタの標準化値平均 (プロファイル比較用)
            const normMeans = activeFeatureNames.map((_, fIdx) => {
                const sum = cluster.samples.reduce((s, sIdx) => s + state.preprocessed.normalized[sIdx][fIdx], 0);
                return sum / cluster.samples.length;
            });

            // 閉じた多角形のために先頭要素を追加
            const rValues = [...normMeans, normMeans[0]];
            const thetaValues = [...activeFeatureNames, activeFeatureNames[0]];

            traces.push({
                type: 'scatterpolar',
                r: rValues,
                theta: thetaValues,
                fill: 'toself',
                fillcolor: cColor + '22', // 薄い透明度
                name: `クラスタ ${cluster.id}`,
                line: { color: cColor, width: 2 }
            });
        });

        const layout = {
            polar: {
                radialaxis: {
                    visible: true,
                    range: [Math.min(-1.5, ...traces.flatMap(t => t.r)) - 0.5, Math.max(1.5, ...traces.flatMap(t => t.r)) + 0.5]
                }
            },
            margin: { t: 40, r: 90, b: 40, l: 90 },
            showlegend: true,
            legend: { orientation: 'h', y: -0.15 }
        };

        Plotly.newPlot('radar-chart', traces, layout, { responsive: true, displayModeBar: false });
    }

    // --- 2D PCA マップ描画 ---
    function renderPcaScatterMap() {
        const { coords, varianceExplained } = window.ClusterEngine.compute2DPCA(state.preprocessed.normalized);
        const traces = [];

        state.clusters.forEach(cluster => {
            const cColor = window.DendrogramRenderer.getClusterColor(cluster.id);
            const xVals = cluster.samples.map(sIdx => coords[sIdx][0]);
            const yVals = cluster.samples.map(sIdx => coords[sIdx][1]);
            const textVals = cluster.samples.map(sIdx => state.sampleNames[sIdx]);

            traces.push({
                x: xVals,
                y: yVals,
                text: textVals,
                mode: 'markers+text',
                type: 'scatter',
                name: `クラスタ ${cluster.id}`,
                textposition: 'top center',
                textfont: { size: 10, color: cColor },
                marker: {
                    size: 10,
                    color: cColor,
                    line: { color: '#ffffff', width: 1 }
                }
            });
        });

        const layout = {
            xaxis: { title: `主成分 1 (${varianceExplained[0].toFixed(1)}%)`, zeroline: true },
            yaxis: { title: `主成分 2 (${varianceExplained[1].toFixed(1)}%)`, zeroline: true },
            margin: { t: 30, r: 30, b: 40, l: 50 },
            showlegend: true,
            hovermode: 'closest'
        };

        Plotly.newPlot('pca-scatter-chart', traces, layout, { responsive: true, displayModeBar: false });
    }

    // --- サンプル割当一覧テーブル描画 ---
    function renderSampleTable() {
        const filterText = sampleSearchInput.value.trim().toLowerCase();
        const activeFeatureNames = state.selectedFeatureIndices.map(i => state.featureNames[i]);
        
        let filteredIndices = [];
        state.sampleNames.forEach((sName, sIdx) => {
            if (!filterText || sName.toLowerCase().includes(filterText)) {
                filteredIndices.push(sIdx);
            }
        });

        sampleCountBadge.textContent = `${filteredIndices.length} / ${state.sampleNames.length} 件`;

        // Thead
        let theadHtml = '<tr><th>No.</th><th>サンプル名</th><th>割当クラスタ</th>';
        activeFeatureNames.forEach(fName => {
            theadHtml += `<th style="text-align: right;">${fName}</th>`;
        });
        theadHtml += '</tr>';
        sampleTable.querySelector('thead').innerHTML = theadHtml;

        // Tbody
        let tbodyHtml = '';
        filteredIndices.forEach(sIdx => {
            const cId = state.assignments[sIdx];
            const cColor = window.DendrogramRenderer.getClusterColor(cId);

            tbodyHtml += `<tr>
                <td style="color: var(--text-muted);">${sIdx + 1}</td>
                <td style="font-weight: 600;">${state.sampleNames[sIdx]}</td>
                <td>
                    <span class="badge" style="background-color: ${cColor}15; color: ${cColor}; border: 1px solid ${cColor}44;">
                        クラスタ ${cId}
                    </span>
                </td>`;

            state.selectedFeatureIndices.forEach(fIdx => {
                const val = state.rawDataMatrix[sIdx][fIdx];
                tbodyHtml += `<td style="text-align: right;">${typeof val === 'number' ? val.toLocaleString() : val}</td>`;
            });

            tbodyHtml += '</tr>';
        });

        sampleTable.querySelector('tbody').innerHTML = tbodyHtml;
    }

    // --- 図の文章解説（ナラティブ）自動生成機能 ---
    function renderNarratives() {
        renderDendrogramNarrative();
        renderSummaryTableNarrative();
        renderRadarNarrative();
        renderPcaNarrative();
    }

    function renderDendrogramNarrative() {
        const el = document.getElementById('narrative-dendrogram');
        if (!el || !state.clusteringResult || !state.clusteringResult.root) return;

        const N = state.sampleNames.length;
        const k = state.currentK;
        const root = state.clusteringResult.root;

        // 切断高度の取得
        const heights = [];
        function collectHeights(node) {
            if (!node || node.isLeaf) return;
            heights.push(node.height);
            collectHeights(node.left);
            collectHeights(node.right);
        }
        collectHeights(root);
        heights.sort((a, b) => b - a);

        let cutHeight = 0;
        if (k - 2 < heights.length && k - 1 < heights.length) {
            cutHeight = (heights[k - 2] + heights[k - 1]) / 2;
        } else if (heights.length > 0) {
            cutHeight = heights[heights.length - 1] * 0.5;
        }

        const linkageNameMap = {
            ward: 'ウォード法', average: 'グループ平均法', complete: '最遠隣法', single: '最近隣法', centroid: '重心法'
        };
        const metricNameMap = {
            euclidean: 'ユークリッド距離', sqeuclidean: '平方ユークリッド距離', manhattan: 'マンハッタン距離', cosine: 'コサイン類似度'
        };

        const methodName = linkageNameMap[state.linkageMethod] || state.linkageMethod;
        const metricName = metricNameMap[state.distanceMetric] || state.distanceMetric;

        let html = `<h5>📝 デンドログラム（樹形図）の図解説</h5>`;
        html += `<p>全 <b>${N}</b> 件のデータを<b>「${methodName} × ${metricName}」</b>で階層的にグループ化した構造です。結合高度 <b>h = ${cutHeight.toFixed(2)}</b> の赤破線で切断することにより、全体が <b>${k} 個のクラスタ</b> に最適分割されています。</p>`;
        html += `<p style="margin-top:0.3rem;">樹形図の右側（縦表示時は下側）で早く枝が繋がっているサンプル同士ほど類似性が高く、左側（縦表示時は上側）での大きな分岐は、まったく異なる性質を持つセグメント同士の境界を表します。</p>`;

        if (state.linkageMethod === 'centroid') {
            html += `<p style="margin-top:0.5rem; padding:0.5rem 0.75rem; background:#fffbeb; border:1px solid #fef3c7; border-radius:6px; color:#b45309; font-size:0.83rem; line-height:1.5;">⚠️ <b>重心法（Centroid）の特性解説</b>: 重心法では、結合が進む過程で新クラスタの重心間距離が局所的に小さくなる「逆転現象（非単調性）」が発生することがあります。当ツールでは枝の突き抜けや極端な歪みが生じないよう包絡スケーリングにより美しく表示補正しています。実務において単調で綺麗な樹形図を求める場合は『ウォード法』または『グループ平均法』の使用が推奨されます。</p>`;
        }

        el.innerHTML = html;
    }

    function renderSummaryTableNarrative() {
        const el = document.getElementById('narrative-summary-table');
        if (!el || !state.clusters || state.clusters.length === 0) return;

        const activeFeatureNames = state.selectedFeatureIndices.map(i => state.featureNames[i]);
        const N = state.sampleNames.length;

        // 全体平均の算出
        const overallMeans = activeFeatureNames.map((_, fIdx) => {
            const sum = state.rawDataMatrix.reduce((s, row) => s + row[state.selectedFeatureIndices[fIdx]], 0);
            return sum / N;
        });

        let html = `<h5>📝 クラスタ特徴サマリーの図解説（自動定性分析）</h5><ul>`;

        state.clusters.forEach(cluster => {
            const cId = cluster.id;
            const count = cluster.samples.length;
            const ratio = ((count / N) * 100).toFixed(1);

            // 各変数の平均と全体に対する乖離度(%)
            const diffs = activeFeatureNames.map((fName, fIdx) => {
                const sum = cluster.samples.reduce((s, sIdx) => s + state.rawDataMatrix[sIdx][state.selectedFeatureIndices[fIdx]], 0);
                const mean = sum / count;
                const overallM = overallMeans[fIdx];
                const pct = overallM !== 0 ? ((mean - overallM) / Math.abs(overallM)) * 100 : 0;
                return { fName, mean, overallM, pct };
            });

            // 乖離度順にソート
            diffs.sort((a, b) => b.pct - a.pct);

            const topHigh1 = diffs[0];
            const topHigh2 = diffs[1];
            const topLow = diffs[diffs.length - 1];

            let traitDesc = "";
            if (topHigh1 && topHigh1.pct > 10) {
                traitDesc += `「<b>${topHigh1.fName}</b> (全体比 +${topHigh1.pct.toFixed(0)}%)」`;
                if (topHigh2 && topHigh2.pct > 10) {
                    traitDesc += `や「<b>${topHigh2.fName}</b> (全体比 +${topHigh2.pct.toFixed(0)}%)」`;
                }
                traitDesc += `が極めて高い特徴を持ちます。`;
            } else {
                traitDesc += `全項目が全体平均に近い標準的プロファイルを持っています。`;
            }

            if (topLow && topLow.pct < -12) {
                traitDesc += ` 一方で「${topLow.fName} (${topLow.pct.toFixed(0)}%)」は比較的低い傾向にあります。`;
            }

            const cColor = window.DendrogramRenderer.getClusterColor(cId);

            const autoLabel = state.clusterLabels ? (state.clusterLabels[cId] || '') : '';
            html += `<li><span style="font-weight:700; color:${cColor}">クラスタ ${cId}「${autoLabel}」</span> (${count}件 / ${ratio}%): ${traitDesc}</li>`;
        });

        html += `</ul>`;
        el.innerHTML = html;
    }

    function renderRadarNarrative() {
        const el = document.getElementById('narrative-radar');
        if (!el) return;

        let html = `<h5>📝 レーダーチャートの図解説</h5>`;
        html += `<p>各クラスタの強み・弱みをZスコア（標準化値）で比較したプロファイル図です。<b>図形が外側に膨らんでいる軸ほどそのグループの突出した強み・個性</b>を表し、形状の違いがセグメント同士の質的違いを明快に示します。</p>`;

        el.innerHTML = html;
    }

    function renderPcaNarrative() {
        const el = document.getElementById('narrative-pca');
        if (!el || !state.preprocessed) return;

        const { varianceExplained } = window.ClusterEngine.compute2DPCA(state.preprocessed.normalized);
        const totalExp = (varianceExplained[0] + varianceExplained[1]).toFixed(1);

        let html = `<h5>📝 2D PCAマップの図解説</h5>`;
        html += `<p>多次元データを主成分分析により最も特徴が表れる2次元平面（情報保持率: <b>${totalExp}%</b>）に縮約・プロットしたマップです。</p>`;
        html += `<p style="margin-top:0.3rem;">同じ色の点がひと塊の領域に集まり、異色のグループ間と境界線で離れているほど、クラスタリングが成功していることを可視化しています。</p>`;

        el.innerHTML = html;
    }

    // --- デンドログラム SVG ダウンロード ---
    function downloadDendrogramSvg() {
        const svgEl = dendrogramContainer.querySelector('svg');
        if (!svgEl) return;

        const serializer = new XMLSerializer();
        let source = serializer.serializeToString(svgEl);

        if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
            source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dendrogram_k${state.currentK}_${state.linkageMethod}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // --- (5-1) デンドログラム PNG ダウンロード ---
    function downloadDendrogramPng() {
        const svgEl = dendrogramContainer.querySelector('svg');
        if (!svgEl) return;
        const serializer = new XMLSerializer();
        const source = serializer.serializeToString(svgEl);
        const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const w = parseFloat(svgEl.getAttribute('width'));
            const h = parseFloat(svgEl.getAttribute('height'));
            
            // キャンバス上限対策（ブラウザの描画限界 8000px を超過しないようにスケール調整）
            let scale = 2;
            if (h * scale > 8000) scale = 8000 / h;
            if (w * scale > 8000) scale = Math.min(scale, 8000 / w);
            if (scale < 0.5) scale = 0.5;

            canvas.width = w * scale;
            canvas.height = h * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            canvas.toBlob(function(blob) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `dendrogram_k${state.currentK}_${state.linkageMethod}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, 'image/png');
        };
        img.src = url;
    }

    // --- (5-2) Plotlyチャート画像保存 ---
    function downloadChartImage(chartId) {
        const chartEl = document.getElementById(chartId);
        if (!chartEl) return;
        Plotly.downloadImage(chartEl, {
            format: 'png',
            width: 800,
            height: 600,
            filename: `${chartId}_k${state.currentK}`
        });
    }

    // --- エクセル出力 (.xlsx) ---
    function exportToExcel() {
        if (!state.assignments || state.assignments.length === 0) return;

        const wb = XLSX.utils.book_new();
        const activeFeatureNames = state.selectedFeatureIndices.map(i => state.featureNames[i]);

        // Sheet 1: 全データとクラスタ割当
        const sheet1Data = [
            ["ID", "サンプル名", "割当クラスタID", ...activeFeatureNames]
        ];
        state.sampleNames.forEach((sName, sIdx) => {
            const rowVals = state.selectedFeatureIndices.map(fIdx => state.rawDataMatrix[sIdx][fIdx]);
            sheet1Data.push([sIdx + 1, sName, `クラスタ ${state.assignments[sIdx]}`, ...rowVals]);
        });
        const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
        XLSX.utils.book_append_sheet(wb, ws1, "全データと割当");

        // Sheet 2: クラスタ要約統計
        const sheet2Data = [
            ["クラスタID", "件数", "構成比(%)", ...activeFeatureNames]
        ];
        const N = state.sampleNames.length;
        state.clusters.forEach(cluster => {
            const count = cluster.samples.length;
            const ratio = parseFloat(((count / N) * 100).toFixed(1));
            const clusterMeans = activeFeatureNames.map((_, fIdx) => {
                const sum = cluster.samples.reduce((s, sIdx) => s + state.rawDataMatrix[sIdx][state.selectedFeatureIndices[fIdx]], 0);
                return parseFloat((sum / count).toFixed(2));
            });
            sheet2Data.push([`クラスタ ${cluster.id}`, count, ratio, ...clusterMeans]);
        });
        const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
        XLSX.utils.book_append_sheet(wb, ws2, "クラスタ要約統計");

        // Sheet 3: 分析設定とメタ情報
        const sheet3Data = [
            ["項目", "設定値・結果"],
            ["分析実行日時", new Date().toLocaleString('ja-JP')],
            ["分析手法 (Linkage)", state.linkageMethod],
            ["距離尺度 (Distance)", state.distanceMetric],
            ["前処理 (Preprocessing)", state.transformMode],
            ["設定クラスタ数 (k)", state.currentK],
            ["自動推奨クラスタ数", state.recommendInfo.recommendedK],
            ["分類の整合性スコア（シルエット係数）", state.silhouetteInfo ? state.silhouetteInfo.meanScore.toFixed(3) : "N/A"]
        ];
        const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
        XLSX.utils.book_append_sheet(wb, ws3, "分析設定とメタ情報");

        // 書き出し
        XLSX.writeFile(wb, `簡易クラスタ分析結果_k${state.currentK}.xlsx`);
    }

    // --- CSV 出力 (.csv) ---
    function exportToCsv() {
        if (!state.assignments || state.assignments.length === 0) return;

        const activeFeatureNames = state.selectedFeatureIndices.map(i => state.featureNames[i]);
        const rows = [
            ["ID", "サンプル名", "割当クラスタ", ...activeFeatureNames]
        ];
        state.sampleNames.forEach((sName, sIdx) => {
            const rowVals = state.selectedFeatureIndices.map(fIdx => state.rawDataMatrix[sIdx][fIdx]);
            rows.push([sIdx + 1, sName, `クラスタ ${state.assignments[sIdx]}`, ...rowVals]);
        });

        const csvContent = "\uFEFF" + rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cluster_result_k${state.currentK}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

});
