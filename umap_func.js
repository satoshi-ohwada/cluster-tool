
    // --- 2D UMAP 計算 (可視化・プロット用) ---
    function compute2DUMAP(matrix) {
        const N = matrix.length;
        if (N === 0) return { coords: [], varianceExplained: [0, 0] };
        
        let nNeighbors = Math.min(15, N - 1);
        if (nNeighbors < 2) nNeighbors = 2;

        const umap = new UMAP({
            nComponents: 2,
            nNeighbors: nNeighbors,
            minDist: 0.1,
            nEpochs: 400
        });
        
        const coords = umap.fit(matrix);

        return {
            coords,
            varianceExplained: [0, 0]
        };
    }
