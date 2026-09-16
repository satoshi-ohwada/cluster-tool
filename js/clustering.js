/**
 * 簡易クラスター分析ツール (Hierarchical Cluster Analysis Engine)
 * 完全にクライアントサイドで動作する階層クラスターリングライブラリ
 */

window.ClusterEngine = (function () {

    // --- 前処理（標準化・正規化） ---
    function preprocessData(matrix, mode) {


        if (!matrix || matrix.length === 0) return { normalized: [], stats: [] };
        const numRows = matrix.length;
        const numCols = matrix[0].length;

        // 列ごとの統計量算出
        const colStats = [];
        for (let j = 0; j < numCols; j++) {
            let values = [];
            for (let i = 0; i < numRows; i++) {
                values.push(matrix[i][j]);
            }
            
            // 対数変換モードの場合の事前処理
            let logShift = 0;
            if (mode === 'log') {
                const rawMinVal = Math.min(...values);
                logShift = rawMinVal <= 0 ? Math.abs(rawMinVal) + 1 : 0;
                values = values.map(v => Math.log(v + logShift));
            }

            const mean = values.reduce((sum, v) => sum + v, 0) / numRows;
            const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (numRows > 1 ? numRows - 1 : 1);
            const stdDev = Math.sqrt(variance);
            const min = Math.min(...values);
            const max = Math.max(...values);
            
            // 中央値とIQR (ロバスト標準化用)
            const sorted = [...values].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const q1 = sorted[Math.floor(sorted.length * 0.25)];
            const q3 = sorted[Math.floor(sorted.length * 0.75)];
            const iqr = (q3 - q1) || 1;

            colStats.push({ mean, stdDev, min, max, median, iqr, logShift });
        }

        // 変換行列の適用
        const normalized = [];
        for (let i = 0; i < numRows; i++) {
            const row = [];
            for (let j = 0; j < numCols; j++) {
                let rawVal = matrix[i][j];
                const st = colStats[j];

                if (mode === 'std' || mode === 'log') {
                    const valToUse = mode === 'log' ? Math.log(rawVal + st.logShift) : rawVal;
                    row.push(st.stdDev === 0 ? 0 : (valToUse - st.mean) / st.stdDev);
                } else if (mode === 'minmax') {
                    row.push((st.max - st.min) === 0 ? 0.5 : (rawVal - st.min) / (st.max - st.min));
                } else if (mode === 'robust') {
                    row.push((rawVal - st.median) / st.iqr);
                } else {
                    // none
                    row.push(rawVal);
                }
            }
            normalized.push(row);
        }



        return { normalized, stats: colStats };
    }

    // --- 距離計算 ---
    function computeDistance(vecA, vecB, metric) {
        const p = vecA.length;
        if (metric === 'sqeuclidean') {
            let sum = 0;
            for (let k = 0; k < p; k++) {
                const diff = vecA[k] - vecB[k];
                sum += diff * diff;
            }
            return sum;
        }
        if (metric === 'manhattan') {
            let sum = 0;
            for (let k = 0; k < p; k++) {
                sum += Math.abs(vecA[k] - vecB[k]);
            }
            return sum;
        }
        if (metric === 'cosine') {
            let dot = 0, normA = 0, normB = 0;
            for (let k = 0; k < p; k++) {
                dot += vecA[k] * vecB[k];
                normA += vecA[k] * vecA[k];
                normB += vecB[k] * vecB[k];
            }
            if (normA === 0 || normB === 0) return 1;
            const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
            return Math.max(0, 1 - sim);
        }
        // デフォルト: ユークリッド距離 (euclidean)
        let sum = 0;
        for (let k = 0; k < p; k++) {
            const diff = vecA[k] - vecB[k];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }

    // --- 階層クラスターリング構築アルゴリズム ---
    function performHierarchicalClustering(dataMatrix, linkageMethod = 'ward', distanceMetric = 'euclidean') {
        const N = dataMatrix.length;
        if (N === 0) return null;

        // 初期ノード群 (葉ノード: 0 ~ N-1)
        const nodes = [];
        for (let i = 0; i < N; i++) {
            nodes.push({
                id: i,
                isLeaf: true,
                sampleIndex: i,
                height: 0,
                size: 1,
                samples: [i],
                left: null,
                right: null
            });
        }

        // 初期距離行列の作成 (全ペア間: Ward法およびCentroid法はLance-Williams漸化式の前提として2乗ユークリッド距離を使用)
        const effectiveMetric = ((linkageMethod === 'ward' || linkageMethod === 'centroid') && distanceMetric === 'euclidean') ? 'sqeuclidean' : distanceMetric;

        const D = Array.from({ length: N }, () => new Float64Array(N));
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const dist = computeDistance(dataMatrix[i], dataMatrix[j], effectiveMetric);
                D[i][j] = dist;
                D[j][i] = dist;
            }
        }

        // アクティブなクラスターの管理
        const activeClusters = new Set(nodes.map(n => n.id));
        const clusterMap = new Map(nodes.map(n => [n.id, n]));
        
        const maxNodes = 2 * N - 1;
        const distMatrix = Array.from({ length: maxNodes }, () => new Float64Array(maxNodes));

        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                distMatrix[i][j] = D[i][j];
            }
        }

        let nextId = N;
        const mergeHistory = [];

        // N-1 回の結合プロセス
        for (let step = 0; step < N - 1; step++) {
            let minDist = Infinity;
            let bestA = -1, bestB = -1;

            const activeList = Array.from(activeClusters);
            for (let i = 0; i < activeList.length; i++) {
                const idA = activeList[i];
                for (let j = i + 1; j < activeList.length; j++) {
                    const idB = activeList[j];
                    const d = distMatrix[idA][idB];

                    if (d < minDist) {
                        minDist = d;
                        bestA = idA;
                        bestB = idB;
                    }
                }
            }

            if (bestA === -1 || bestB === -1) break;

            const nodeA = clusterMap.get(bestA);
            const nodeB = clusterMap.get(bestB);

            let displayHeight = minDist;
            if (effectiveMetric === 'sqeuclidean') {
                displayHeight = Math.sqrt(minDist);
            }

            const newId = nextId++;
            const newNode = {
                id: newId,
                isLeaf: false,
                sampleIndex: -1,
                left: nodeA,
                right: nodeB,
                height: displayHeight,
                size: nodeA.size + nodeB.size,
                samples: [...nodeA.samples, ...nodeB.samples]
            };

            clusterMap.set(newId, newNode);

            for (const idK of activeClusters) {
                if (idK === bestA || idK === bestB) continue;

                const nodeK = clusterMap.get(idK);
                const dAK = distMatrix[bestA][idK];
                const dBK = distMatrix[bestB][idK];
                const dAB = distMatrix[bestA][bestB];
                const nA = nodeA.size, nB = nodeB.size, nK = nodeK.size;

                let dNewK = 0;
                if (linkageMethod === 'single') {
                    dNewK = Math.min(dAK, dBK);
                } else if (linkageMethod === 'complete') {
                    dNewK = Math.max(dAK, dBK);
                } else if (linkageMethod === 'average') {
                    dNewK = (nA * dAK + nB * dBK) / (nA + nB);
                } else if (linkageMethod === 'centroid') {
                    dNewK = (nA * dAK + nB * dBK) / (nA + nB) - (nA * nB * dAB) / Math.pow(nA + nB, 2);
                } else if (linkageMethod === 'ward') {
                    dNewK = ((nA + nK) * dAK + (nB + nK) * dBK - nK * dAB) / (nA + nB + nK);
                }

                distMatrix[newId][idK] = dNewK;
                distMatrix[idK][newId] = dNewK;
            }

            activeClusters.delete(bestA);
            activeClusters.delete(bestB);
            activeClusters.add(newId);

            mergeHistory.push({
                step: step + 1,
                nodeA: bestA,
                nodeB: bestB,
                newId: newId,
                height: displayHeight
            });
        }

        const rootId = Array.from(activeClusters)[0];
        const root = clusterMap.get(rootId);



        return {
            root,
            mergeHistory,
            nodes: clusterMap,
            N
        };
    }

    // --- 葉ノードのインオーダー順序（ツリー表示の交差防止） ---
    function getLeafOrder(node) {
        if (!node) return [];
        if (node.isLeaf) return [node.sampleIndex];
        return [...getLeafOrder(node.left), ...getLeafOrder(node.right)];
    }

    // --- ツリーの切断とクラスター割り当て (指定されたクラスター数 k に分割) ---
    function cutTree(root, k, N) {
        if (!root || k <= 1) {


            return {
                assignments: new Array(N).fill(1),
                clusters: [{ id: 1, samples: root ? root.samples : [], root: root }]
            };
        }

        const subtrees = [root];
        while (subtrees.length < k) {
            let maxIdx = -1;
            let maxHeight = -1;
            for (let i = 0; i < subtrees.length; i++) {
                if (!subtrees[i].isLeaf && subtrees[i].height > maxHeight) {
                    maxHeight = subtrees[i].height;
                    maxIdx = i;
                }
            }

            if (maxIdx === -1) break;

            const target = subtrees[maxIdx];
            subtrees.splice(maxIdx, 1, target.left, target.right);
        }

        subtrees.sort((a, b) => b.size - a.size);

        const assignments = new Array(N);
        const clusters = [];

        subtrees.forEach((subtree, idx) => {
            const clusterId = idx + 1;
            subtree.samples.forEach(sIdx => {
                assignments[sIdx] = clusterId;
            });
            clusters.push({
                id: clusterId,
                samples: subtree.samples,
                root: subtree
            });
        });



        return { assignments, clusters };
    }

    // --- シルエット係数 (Silhouette Score) の計算 ---
    function calculateSilhouetteScore(dataMatrix, assignments, k, distanceMetric = 'euclidean') {
        const N = dataMatrix.length;

        if (N <= 1 || k <= 1) return { meanScore: 0, sampleScores: new Array(N).fill(0) };

        const distMat = Array.from({ length: N }, () => new Float64Array(N));
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const d = computeDistance(dataMatrix[i], dataMatrix[j], distanceMetric);
                distMat[i][j] = d;
                distMat[j][i] = d;
            }
        }

        const clusterMembers = new Map();
        for (let i = 0; i < N; i++) {
            const cId = assignments[i];
            if (!clusterMembers.has(cId)) clusterMembers.set(cId, []);
            clusterMembers.get(cId).push(i);
        }

        const sampleScores = new Float64Array(N);
        let totalScore = 0;

        for (let i = 0; i < N; i++) {
            const ownClusterId = assignments[i];
            const ownMembers = clusterMembers.get(ownClusterId);

            // 単一要素クラスタ（孤立点）の場合は標準定義（scikit-learn等準拠）に基づきシルエット係数を 0 とする
            if (!ownMembers || ownMembers.length <= 1) {
                sampleScores[i] = 0;
                continue;
            }

            let sumDistOwn = 0;
            for (const mIdx of ownMembers) {
                if (mIdx !== i) sumDistOwn += distMat[i][mIdx];
            }
            const a_i = sumDistOwn / (ownMembers.length - 1);

            let b_i = Infinity;
            for (const [otherCId, otherMembers] of clusterMembers.entries()) {
                if (otherCId === ownClusterId) continue;

                let sumDistOther = 0;
                for (const mIdx of otherMembers) {
                    sumDistOther += distMat[i][mIdx];
                }
                const avgDist = sumDistOther / otherMembers.length;
                if (avgDist < b_i) {
                    b_i = avgDist;
                }
            }

            if (b_i === Infinity) b_i = 0;

            const max_ab = Math.max(a_i, b_i);
            const s_i = max_ab === 0 ? 0 : (b_i - a_i) / max_ab;
            sampleScores[i] = s_i;
            totalScore += s_i;
        }

        return {
            meanScore: totalScore / N,
            sampleScores: Array.from(sampleScores)
        };
    }

    // --- Calinski-Harabasz 指標 (最大化) ---
    function calculateCHIndex(dataMatrix, assignments, k) {
        const N = dataMatrix.length;
        if (N <= k || k <= 1) return 0;
        const P = dataMatrix[0].length;

        const globalMean = new Array(P).fill(0);
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < P; j++) {
                globalMean[j] += dataMatrix[i][j];
            }
        }
        for (let j = 0; j < P; j++) globalMean[j] /= N;

        const clusterMembers = new Map();
        for (let i = 0; i < N; i++) {
            const cId = assignments[i];
            if (!clusterMembers.has(cId)) clusterMembers.set(cId, []);
            clusterMembers.get(cId).push(i);
        }

        let trW = 0;
        let trB = 0;

        for (const [cId, members] of clusterMembers.entries()) {
            const n_c = members.length;
            if (n_c === 0) continue;

            const cMean = new Array(P).fill(0);
            for (const mIdx of members) {
                for (let j = 0; j < P; j++) {
                    cMean[j] += dataMatrix[mIdx][j];
                }
            }
            for (let j = 0; j < P; j++) cMean[j] /= n_c;

            for (const mIdx of members) {
                for (let j = 0; j < P; j++) {
                    const diff = dataMatrix[mIdx][j] - cMean[j];
                    trW += diff * diff;
                }
            }

            let bDistSq = 0;
            for (let j = 0; j < P; j++) {
                const diff = cMean[j] - globalMean[j];
                bDistSq += diff * diff;
            }
            trB += n_c * bDistSq;
        }

        if (trW === 0) return 0;
        return (trB / (k - 1)) / (trW / (N - k));
    }

    // --- Davies-Bouldin 指標 (最小化) ---
    function calculateDBIndex(dataMatrix, assignments, k) {
        const N = dataMatrix.length;
        if (N <= k || k <= 1) return Infinity;
        const P = dataMatrix[0].length;

        const clusterMembers = new Map();
        for (let i = 0; i < N; i++) {
            const cId = assignments[i];
            if (!clusterMembers.has(cId)) clusterMembers.set(cId, []);
            clusterMembers.get(cId).push(i);
        }

        const centroids = new Map();
        const dispersions = new Map();

        for (const [cId, members] of clusterMembers.entries()) {
            const n_c = members.length;
            const cMean = new Array(P).fill(0);
            for (const mIdx of members) {
                for (let j = 0; j < P; j++) {
                    cMean[j] += dataMatrix[mIdx][j];
                }
            }
            for (let j = 0; j < P; j++) cMean[j] /= n_c;
            centroids.set(cId, cMean);

            let s = 0;
            for (const mIdx of members) {
                let distSq = 0;
                for (let j = 0; j < P; j++) {
                    const diff = dataMatrix[mIdx][j] - cMean[j];
                    distSq += diff * diff;
                }
                s += Math.sqrt(distSq);
            }
            dispersions.set(cId, n_c > 0 ? s / n_c : 0);
        }

        let dbIndex = 0;
        const cIds = Array.from(clusterMembers.keys());

        for (let i = 0; i < cIds.length; i++) {
            const idI = cIds[i];
            let maxVal = -Infinity;
            for (let j = 0; j < cIds.length; j++) {
                if (i === j) continue;
                const idJ = cIds[j];
                
                let distSq = 0;
                for (let p = 0; p < P; p++) {
                    const diff = centroids.get(idI)[p] - centroids.get(idJ)[p];
                    distSq += diff * diff;
                }
                const m_ij = Math.sqrt(distSq);

                if (m_ij > 0) {
                    const val = (dispersions.get(idI) + dispersions.get(idJ)) / m_ij;
                    if (val > maxVal) maxVal = val;
                }
            }
            if (maxVal !== -Infinity) {
                dbIndex += maxVal;
            }
        }

        return dbIndex / k;
    }

    // --- 自動最適クラスター数の推奨 (複数指標による多数決) ---
    function recommendOptimalK(root, dataMatrix, distanceMetric = 'euclidean') {
        const N = dataMatrix.length;

        if (N <= 2) return { recommendedK: 2, silhouetteScores: {}, reason: "サンプル数が少ないため k=2 を推奨します" };

        const maxK = Math.min(10, N - 1);
        const silhouetteScores = {};
        const chScores = {};
        const dbScores = {};

        let bestK_Sil = 2;
        let maxSilhouette = -Infinity;

        let bestK_CH = 2;
        let maxCH = -Infinity;

        let bestK_DB = 2;
        let minDB = Infinity;

        for (let k = 2; k <= maxK; k++) {
            const { assignments } = cutTree(root, k, N);
            
            // 1. シルエット係数 (最大化)
            const { meanScore } = calculateSilhouetteScore(dataMatrix, assignments, k, distanceMetric);
            silhouetteScores[k] = meanScore;
            if (meanScore > maxSilhouette) {
                maxSilhouette = meanScore;
                bestK_Sil = k;
            }

            // 2. Calinski-Harabasz 指標 (最大化)
            const ch = calculateCHIndex(dataMatrix, assignments, k);
            chScores[k] = ch;
            if (ch > maxCH) {
                maxCH = ch;
                bestK_CH = k;
            }

            // 3. Davies-Bouldin 指標 (最小化)
            const db = calculateDBIndex(dataMatrix, assignments, k);
            dbScores[k] = db;
            if (db < minDB) {
                minDB = db;
                bestK_DB = k;
            }
        }

        // 多数決 (Voting)
        const votes = {};
        votes[bestK_Sil] = (votes[bestK_Sil] || 0) + 1;
        votes[bestK_CH] = (votes[bestK_CH] || 0) + 1;
        votes[bestK_DB] = (votes[bestK_DB] || 0) + 1;

        let bestK = 2;
        let maxVotes = 0;
        for (const [kStr, count] of Object.entries(votes)) {
            const kInt = parseInt(kStr);
            if (count > maxVotes) {
                maxVotes = count;
                bestK = kInt;
            } else if (count === maxVotes) {
                // 同票の場合はシルエット係数に基づくクラスター数を優先
                if (kInt === bestK_Sil) {
                    bestK = kInt;
                }
            }
        }

        let reason = `複数の指標（Silhouette, Calinski-Harabasz, Davies-Bouldin）による多数決に基づき、**クラスター数 ${bestK}** を自動推奨します。<br>`;
        reason += `・Silhouette係数最適: k=${bestK_Sil}<br>`;
        reason += `・Calinski-Harabasz最適: k=${bestK_CH}<br>`;
        reason += `・Davies-Bouldin最適: k=${bestK_DB}`;

        return {
            recommendedK: bestK,
            silhouetteScores,
            maxSilhouette,
            reason
        };
    }

    // --- 簡易 2D PCA 計算 (可視化・プロット用) ---
    function compute2DPCA(matrix) {
        const N = matrix.length;


        if (N === 0) return { coords: [], varianceExplained: [0, 0] };
        const P = matrix[0].length;

        const mean = new Array(P).fill(0);
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < P; j++) {
                mean[j] += matrix[i][j];
            }
        }
        mean.forEach((_, j) => mean[j] /= N);

        const X = matrix.map(row => row.map((v, j) => v - mean[j]));

        const Cov = Array.from({ length: P }, () => new Float64Array(P));
        for (let j1 = 0; j1 < P; j1++) {
            for (let j2 = j1; j2 < P; j2++) {
                let sum = 0;
                for (let i = 0; i < N; i++) {
                    sum += X[i][j1] * X[i][j2];
                }
                const covVal = sum / (N > 1 ? N - 1 : 1);
                Cov[j1][j2] = covVal;
                Cov[j2][j1] = covVal;
            }
        }

        function powerIteration(covMat, p) {
            // 決定論的かつ部分空間に直交しにくい初期ベクトル
            let vec = Array.from({ length: p }, (_, i) => 1.0 / Math.sqrt(i + 1));
            let norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
            vec = vec.map(v => v / (norm || 1));

            for (let iter = 0; iter < 100; iter++) {
                const nextVec = new Array(p).fill(0);
                for (let i = 0; i < p; i++) {
                    for (let j = 0; j < p; j++) {
                        nextVec[i] += covMat[i][j] * vec[j];
                    }
                }
                norm = Math.sqrt(nextVec.reduce((s, v) => s + v * v, 0));
                vec = nextVec.map(v => v / (norm || 1));
            }

            // 符号の決定論的正規化（最大絶対値の成分を常に正とし、再描画ごとの散布図反転を防止）
            let maxAbs = -1;
            let sign = 1;
            for (let i = 0; i < p; i++) {
                const absVal = Math.abs(vec[i]);
                if (absVal > maxAbs) {
                    maxAbs = absVal;
                    sign = vec[i] >= 0 ? 1 : -1;
                }
            }
            if (sign < 0) {
                vec = vec.map(v => -v);
            }

            return { vector: vec, eigenvalue: norm };
        }

        const pc1 = powerIteration(Cov, P);

        const Cov2 = Array.from({ length: P }, () => new Float64Array(P));
        for (let i = 0; i < P; i++) {
            for (let j = 0; j < P; j++) {
                Cov2[i][j] = Cov[i][j] - pc1.eigenvalue * pc1.vector[i] * pc1.vector[j];
            }
        }
        const pc2 = powerIteration(Cov2, P);

        const coords = X.map(row => {
            const x = row.reduce((s, v, j) => s + v * pc1.vector[j], 0);
            const y = row.reduce((s, v, j) => s + v * pc2.vector[j], 0);
            return [x, y];
        });

        const totalVar = Cov.reduce((sum, row, j) => sum + row[j], 0);
        const exp1 = totalVar > 0 ? (pc1.eigenvalue / totalVar) * 100 : 50;
        const exp2 = totalVar > 0 ? (pc2.eigenvalue / totalVar) * 100 : 30;



        return {
            coords,
            varianceExplained: [exp1, exp2]
        };
    }



    // --- 2D UMAP 計算 (可視化・プロット用) ---
    function compute2DUMAP(matrix) {
        const N = matrix.length;
        if (N === 0) return { coords: [], varianceExplained: [0, 0] };
        
        let nNeighbors = Math.min(15, N - 1);
        if (nNeighbors < 2) nNeighbors = 2; // minimum neighbors required

        const umap = new UMAP.UMAP({
            nComponents: 2,
            nNeighbors: nNeighbors,
            minDist: 0.1,
            nEpochs: 400
        });
        
        const coords = umap.fit(matrix);

        // UMAP doesn't have "variance explained" in the same way as PCA,
        // but we'll return dummy values to not break downstream code
        return {
            coords,
            varianceExplained: [0, 0] 
        };
    }

    return {
        preprocessData,
        computeDistance,
        performHierarchicalClustering,
        getLeafOrder,
        cutTree,
        calculateSilhouetteScore,
        recommendOptimalK,
        compute2DPCA,
        compute2DUMAP
    };

})();
