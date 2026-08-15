/**
 * 簡易クラスタ分析ツール (SVG Dendrogram Renderer)
 * 高精細なインタラクティブ・デンドログラム描画ライブラリ
 */

window.DendrogramRenderer = (function () {

    // クラスタ表示用の高品質カラーパレット
    const CLUSTER_COLORS = [
        '#3b82f6', // 1: ブルー
        '#ef4444', // 2: レッド
        '#10b981', // 3: エメラルド
        '#8b5cf6', // 4: パープル
        '#f59e0b', // 5: アンバー
        '#06b6d4', // 6: シアン
        '#ec4899', // 7: ピンク
        '#6366f1', // 8: インディゴ
        '#84cc16', // 9: ライム
        '#14b8a6'  // 10: ティール
    ];

    function getClusterColor(clusterId) {
        if (!clusterId || clusterId < 1) return '#64748b'; // デフォルトグレー
        return CLUSTER_COLORS[(clusterId - 1) % CLUSTER_COLORS.length];
    }

    /**
     * 重心法等の非単調（非モノトニック）な結合高さ逆転現象を補正し、
     * 親ノードの描画用高度を算出する関数
     */
    function getRenderHeight(node) {
        if (!node) return 0;
        if (node.isLeaf) return 0;
        const leftH = getRenderHeight(node.left);
        const rightH = getRenderHeight(node.right);
        // モノトニック包絡線を適用（重心法で child > parent になった場合の突出・反転を補正）
        return Math.max(node.height, leftH, rightH);
    }

    /**
     * デンドログラムを描画する関数
     */
    function render(container, clusteringResult, sampleLabels, currentK, assignments, options = {}) {
        if (!container || !clusteringResult || !clusteringResult.root) return;

        const { root, N } = clusteringResult;
        const orientation = options.orientation || 'vertical'; // vertical (上→下) or horizontal (左→右)
        const onSelectK = options.onSelectK || null;

        container.innerHTML = '';

        // マージン設定 (横向き表示時は右側に十分なラベル領域を確保)
        const margin = orientation === 'vertical'
            ? { top: 40, right: 40, bottom: 130, left: 60 }
            : { top: 40, right: 180, bottom: 30, left: 60 };

        // コンテナの寸法（サンプル数 N に応じて可変拡大し重なりを防止）
        const calcWidth = orientation === 'vertical'
            ? Math.max(700, N * 22 + margin.left + margin.right)
            : Math.max(750, container.clientWidth || 800);
            
        const calcHeight = orientation === 'horizontal'
            ? Math.max(500, N * 22 + margin.top + margin.bottom)
            : Math.max(450, options.height || 500);

        const containerWidth = calcWidth;
        const containerHeight = calcHeight;

        const width = containerWidth - margin.left - margin.right;
        const height = containerHeight - margin.top - margin.bottom;

        // 全ツリー中の絶対最大描画高度を取得（重心法などの逆転時にも突き抜けないよう画面全体を正規化）
        const maxHeight = getRenderHeight(root) || 1;

        // 葉ノードの位置計算 (Leaf X/Y Coordinates)
        const leafOrder = window.ClusterEngine.getLeafOrder(root);
        const leafPositions = new Map(); // sampleIndex -> position index (0 ... N-1)

        leafOrder.forEach((sIdx, orderIdx) => {
            leafPositions.set(sIdx, orderIdx);
        });

        // 再帰的に各ノードのSVG座標を計算
        function layoutNode(node) {
            if (node.isLeaf) {
                const orderIdx = leafPositions.get(node.sampleIndex);
                const step = N > 1 ? (orientation === 'vertical' ? width : height) / (N - 1) : 0;
                
                let x, y;
                if (orientation === 'vertical') {
                    x = orderIdx * step;
                    y = height; // 縦向き: 下端が葉ノード (height)
                } else {
                    x = width; // 横向き: 右端が葉ノード (width)
                    y = orderIdx * step;
                }

                const cId = assignments ? assignments[node.sampleIndex] : null;
                const nodeColor = getClusterColor(cId);

                return {
                    x,
                    y,
                    node,
                    clusterId: cId,
                    color: nodeColor
                };
            }

            // 内部ノード
            const leftLayout = layoutNode(node.left);
            const rightLayout = layoutNode(node.right);

            const renderH = getRenderHeight(node);
            const normHeight = Math.min(1, Math.max(0, renderH / maxHeight));

            let x, y;
            if (orientation === 'vertical') {
                x = (leftLayout.x + rightLayout.x) / 2;
                y = height * (1 - normHeight); // 上がroot (y=0)
            } else {
                x = width * (1 - normHeight); // 左がroot (x=0)、右が葉 (x=width)
                y = (leftLayout.y + rightLayout.y) / 2;
            }

            // 左右のサブツリーが同一クラスタに属していればその色、異なればグレー
            let clusterId = null;
            if (leftLayout.clusterId && leftLayout.clusterId === rightLayout.clusterId) {
                clusterId = leftLayout.clusterId;
            }
            const color = getClusterColor(clusterId);

            return {
                x,
                y,
                node,
                left: leftLayout,
                right: rightLayout,
                clusterId,
                color
            };
        }

        const layoutTree = layoutNode(root);

        // SVGエレメント作成
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', containerWidth);
        svg.setAttribute('height', containerHeight);
        svg.setAttribute('viewBox', `0 0 ${containerWidth} ${containerHeight}`);
        svg.style.fontFamily = 'Inter, sans-serif';
        svg.style.display = 'block';

        // 描画メイングループ
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${margin.left}, ${margin.top})`);
        svg.appendChild(g);

        // スケール軸 描画
        drawScaleAxis(g, maxHeight, width, height, orientation);

        // 分割閾値ライン (Cut Line) の表示
        let cutHeight = getCutHeight(root, currentK, N);
        drawCutLine(g, cutHeight, maxHeight, width, height, currentK, orientation, (newK) => {
            if (onSelectK) onSelectK(newK);
        });

        // ブランチ (枝) 描画
        const pathGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        pathGroup.setAttribute('class', 'branches');
        g.appendChild(pathGroup);

        // ノード＆ツールチップ用グループ
        const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nodeGroup.setAttribute('class', 'nodes');
        g.appendChild(nodeGroup);

        // 葉ラベル用グループ
        const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        labelGroup.setAttribute('class', 'leaf-labels');
        g.appendChild(labelGroup);

        // 再帰的にパスとノードを出力
        function renderBranchesAndNodes(lNode) {
            if (lNode.left && lNode.right) {
                // 枝の描画 (U字型 / コの字型パス)
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                let d = '';

                if (orientation === 'vertical') {
                    // (x1, y1) -> (x1, y) -> (x2, y) -> (x2, y2)
                    d = `M ${lNode.left.x} ${lNode.left.y} ` +
                        `V ${lNode.y} ` +
                        `H ${lNode.right.x} ` +
                        `V ${lNode.right.y}`;
                } else {
                    // (x1, y1) -> (x, y1) -> (x, y2) -> (x2, y2)
                    d = `M ${lNode.left.x} ${lNode.left.y} ` +
                        `H ${lNode.x} ` +
                        `V ${lNode.right.y} ` +
                        `H ${lNode.right.x}`;
                }

                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', lNode.color);
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-linejoin', 'round');
                path.setAttribute('stroke-linecap', 'round');
                path.style.transition = 'stroke 0.3s ease, stroke-width 0.2s ease';
                pathGroup.appendChild(path);

                // 結合ノードの丸印
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', lNode.x);
                circle.setAttribute('cy', lNode.y);
                circle.setAttribute('r', '4');
                circle.setAttribute('fill', lNode.color);
                circle.setAttribute('stroke', '#ffffff');
                circle.setAttribute('stroke-width', '1.5');
                circle.style.cursor = 'pointer';

                // ツールチップ設定 (逆転現象の検知)
                const isReversal = lNode.left && lNode.right && (lNode.node.height < getRenderHeight(lNode.left.node) || lNode.node.height < getRenderHeight(lNode.right.node));
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = `結合高さ: ${lNode.node.height.toFixed(3)}${isReversal ? ' (※重心法による逆転現象)' : ''}\n構成サンプル数: ${lNode.node.size} 件`;
                circle.appendChild(title);

                nodeGroup.appendChild(circle);

                renderBranchesAndNodes(lNode.left);
                renderBranchesAndNodes(lNode.right);
            } else if (lNode.node.isLeaf) {
                // 葉ノードのラベル描画
                const labelText = sampleLabels[lNode.node.sampleIndex] || `Sample ${lNode.node.sampleIndex + 1}`;
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');

                if (orientation === 'vertical') {
                    text.setAttribute('x', lNode.x);
                    text.setAttribute('y', lNode.y + 12);
                    text.setAttribute('transform', `rotate(45, ${lNode.x}, ${lNode.y + 12})`);
                    text.setAttribute('text-anchor', 'start');
                } else {
                    // 横向き表示: 葉ノード (x=width) の右側にラベルを描画
                    text.setAttribute('x', lNode.x + 10);
                    text.setAttribute('y', lNode.y + 4);
                    text.setAttribute('text-anchor', 'start');
                }

                text.setAttribute('fill', lNode.color);
                text.setAttribute('font-size', '12px');
                text.setAttribute('font-weight', '600');
                text.style.cursor = 'default';
                text.textContent = labelText;

                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = `[${lNode.clusterId ? 'クラスタ ' + lNode.clusterId : '未割り当て'}] ${labelText}`;
                text.appendChild(title);

                labelGroup.appendChild(text);
            }
        }

        renderBranchesAndNodes(layoutTree);

        container.appendChild(svg);
    }

    // 高さ軸（スケール）の描画
    function drawScaleAxis(g, maxHeight, width, height, orientation) {
        const axisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        axisGroup.setAttribute('class', 'axis');

        const ticks = 5;
        for (let i = 0; i <= ticks; i++) {
            const ratio = i / ticks;
            const hVal = maxHeight * (1 - ratio);

            let x1, y1, x2, y2, tx, ty, anchor;
            if (orientation === 'vertical') {
                x1 = -10; y1 = height * ratio;
                x2 = width; y2 = height * ratio;
                tx = -15; ty = height * ratio + 4;
                anchor = 'end';
            } else {
                x1 = width * (1 - ratio); y1 = -10;
                x2 = width * (1 - ratio); y2 = height;
                tx = width * (1 - ratio); ty = -15;
                anchor = 'middle';
            }

            // 目盛りグリッド線
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1); line.setAttribute('y1', y1);
            line.setAttribute('x2', x2); line.setAttribute('y2', y2);
            line.setAttribute('stroke', '#e2e8f0');
            line.setAttribute('stroke-dasharray', '3,3');
            axisGroup.appendChild(line);

            // 目盛り数値
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', tx); text.setAttribute('y', ty);
            text.setAttribute('fill', '#94a3b8');
            text.setAttribute('font-size', '10px');
            text.setAttribute('text-anchor', anchor);
            text.textContent = hVal.toFixed(2);
            axisGroup.appendChild(text);
        }

        g.appendChild(axisGroup);
    }

    // クラスタ数 k に対応する切断高度 cutHeight の算出
    function getCutHeight(root, k, N) {
        if (!root || k <= 1) return getRenderHeight(root) * 1.05;

        const heights = [];
        function collectHeights(node) {
            if (!node || node.isLeaf) return;
            heights.push(getRenderHeight(node));
            collectHeights(node.left);
            collectHeights(node.right);
        }
        collectHeights(root);
        heights.sort((a, b) => b - a);

        if (k - 2 < heights.length && k - 1 < heights.length) {
            return (heights[k - 2] + heights[k - 1]) / 2;
        } else if (heights.length > 0) {
            return heights[heights.length - 1] * 0.5;
        }
        return 0;
    }

    // 切断閾値線の描画
    function drawCutLine(g, cutHeight, maxHeight, width, height, currentK, orientation, onSelectK) {
        const cutGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        cutGroup.setAttribute('class', 'cut-line-group');

        const normCut = Math.min(1, Math.max(0, cutHeight / maxHeight));

        let x1, y1, x2, y2, bx, by;
        if (orientation === 'vertical') {
            x1 = -10; y1 = height * (1 - normCut);
            x2 = width + 10; y2 = height * (1 - normCut);
            bx = width - 80; by = y1 - 8;
        } else {
            x1 = width * (1 - normCut); y1 = -10;
            x2 = width * (1 - normCut); y2 = height + 10;
            bx = x1 + 8; by = 20;
        }

        // 赤破線
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#ef4444');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '6,4');
        cutGroup.appendChild(line);

        // バッジ
        const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        badgeBg.setAttribute('x', bx - 5); badgeBg.setAttribute('y', by - 14);
        badgeBg.setAttribute('width', '130'); badgeBg.setAttribute('height', '20');
        badgeBg.setAttribute('rx', '4');
        badgeBg.setAttribute('fill', '#ef4444');
        badgeBg.setAttribute('opacity', '0.9');
        cutGroup.appendChild(badgeBg);

        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeText.setAttribute('x', bx + 60); badgeText.setAttribute('y', by);
        badgeText.setAttribute('fill', '#ffffff');
        badgeText.setAttribute('font-size', '11px');
        badgeText.setAttribute('font-weight', 'bold');
        badgeText.setAttribute('text-anchor', 'middle');
        badgeText.textContent = `切断: k=${currentK} (h=${cutHeight.toFixed(2)})`;
        cutGroup.appendChild(badgeText);

        g.appendChild(cutGroup);
    }

    return {
        render,
        getClusterColor,
        getCutHeight,
        CLUSTER_COLORS
    };

})();
