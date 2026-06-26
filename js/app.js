/* Движок геопортала на MapLibre GL JS. Управляется через window.PORTAL_CONFIG (config.js). */
(function () {
  "use strict";

  var cfg = window.PORTAL_CONFIG;
  var POPUP = cfg.popup || {};
  var searchIndex = []; // {name, type, lngLat:[lng,lat], layerId, open()}
  var EMPTY_FC = { type: "FeatureCollection", features: [] };
  var measureActive = false;

  // ============================================================
  //  Стиль карты: растровые подложки
  // ============================================================
  function basemapTiles(b) {
    if (b.url.indexOf("{s}") !== -1) {
      return ["a", "b", "c"].map(function (s) { return b.url.replace("{s}", s); });
    }
    return [b.url];
  }

  var defaultBasemap = cfg.basemaps.find(function (b) { return b.default; }) || cfg.basemaps[0];

  var style = { version: 8, sources: {}, layers: [] };
  cfg.basemaps.forEach(function (b) {
    style.sources["base-" + b.id] = {
      type: "raster",
      tiles: basemapTiles(b),
      tileSize: 256,
      maxzoom: b.maxZoom || cfg.map.maxZoom,
      attribution: b.attribution || ""
    };
    style.layers.push({
      id: "base-" + b.id,
      type: "raster",
      source: "base-" + b.id,
      layout: { visibility: b.id === defaultBasemap.id ? "visible" : "none" }
    });
  });

  var map = new maplibregl.Map({
    container: "map",
    style: style,
    center: [cfg.map.center[1], cfg.map.center[0]], // MapLibre: [lng, lat]
    zoom: cfg.map.zoom,
    minZoom: cfg.map.minZoom,
    maxZoom: cfg.map.maxZoom,
    attributionControl: false
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

  // ============================================================
  //  Переключатель подложек (кастомный контрол)
  // ============================================================
  function BasemapControl() {}
  BasemapControl.prototype.onAdd = function (m) {
    var container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group basemap-ctrl";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "basemap-toggle";
    btn.title = "Подложки";
    btn.textContent = "🗺";

    var panel = document.createElement("div");
    panel.className = "basemap-panel";

    cfg.basemaps.forEach(function (b) {
      var lab = document.createElement("label");
      var r = document.createElement("input");
      r.type = "radio";
      r.name = "basemap-radio";
      r.checked = b.id === defaultBasemap.id;
      r.addEventListener("change", function () {
        cfg.basemaps.forEach(function (x) {
          m.setLayoutProperty("base-" + x.id, "visibility", x.id === b.id ? "visible" : "none");
        });
      });
      var sp = document.createElement("span");
      sp.textContent = b.name;
      lab.appendChild(r);
      lab.appendChild(sp);
      panel.appendChild(lab);
    });

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      container.classList.toggle("open");
    });
    document.addEventListener("click", function () { container.classList.remove("open"); });

    container.appendChild(btn);
    container.appendChild(panel);
    this._container = container;
    return container;
  };
  BasemapControl.prototype.onRemove = function () {
    if (this._container && this._container.parentNode) this._container.parentNode.removeChild(this._container);
  };
  map.addControl(new BasemapControl(), "top-right");

  // ============================================================
  //  Утилиты
  // ============================================================
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function markerColor(markerCfg, props) {
    var key = (props || {})[markerCfg.colorField];
    return (markerCfg.colors && markerCfg.colors[key]) || markerCfg.defaultColor || "#ff4081";
  }

  function starSvg(color, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
      'style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">' +
      '<path d="M12 .8l3.4 6.9 7.6 1.1-5.5 5.36 1.3 7.58L12 18.16 5.2 21.74l1.3-7.58L1 8.8l7.6-1.1z" ' +
      'fill="' + color + '" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  }

  function makeStarEl(color, size) {
    size = size || 24;
    var el = document.createElement("div");
    el.className = "star-marker";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.cursor = "pointer";
    el.innerHTML = starSvg(color, size);
    return el;
  }

  // ============================================================
  //  Попап достопримечательностей (с фото/пометками)
  // ============================================================
  function buildPopupHtml(props, pcfg) {
    pcfg = pcfg || POPUP;
    var title = props[pcfg.titleField];
    var type = props[pcfg.typeField];
    var desc = props[pcfg.descriptionField];
    var photo = props[pcfg.photoField];
    var labels = pcfg.fieldLabels || {};
    var reserved = [pcfg.titleField, pcfg.typeField, pcfg.descriptionField, pcfg.photoField];

    var html = '<div class="feature-popup">';
    if (photo) html += '<img src="' + escapeHtml(photo) + '" alt="' + escapeHtml(title || "") + '" loading="lazy" />';
    html += '<div class="pp-body">';
    if (type) html += '<span class="pp-type">' + escapeHtml(type) + "</span>";
    if (title) html += "<h3>" + escapeHtml(title) + "</h3>";
    if (desc) html += '<p class="pp-desc">' + escapeHtml(desc) + "</p>";

    if (!pcfg.hideAttributes) {
      var rows = "";
      Object.keys(props).forEach(function (key) {
        if (reserved.indexOf(key) !== -1) return;
        var val = props[key];
        if (val === null || val === undefined || val === "") return;
        var label = labels[key] || key;
        rows += "<tr><td>" + escapeHtml(label) + "</td><td>" + escapeHtml(val) + "</td></tr>";
      });
      if (rows) html += "<table>" + rows + "</table>";
    }

    var slots = pcfg.photoSlots || 0;
    if (slots > 0) {
      var photos = (pcfg.photos && pcfg.photos[title]) || [];
      var notes = (pcfg.notes && pcfg.notes[title]) || [];
      if (photos.length === 0 && notes[0]) {
        html += '<div class="pp-note">' + escapeHtml(notes[0]) + "</div>";
      } else {
        var hasPhoto = photos.length > 0;
        var count = hasPhoto ? Math.max(photos.length, notes.length) : slots;
        html += '<div class="pp-photos">';
        for (var i = 0; i < count; i++) {
          if (photos[i]) {
            html += '<a class="pp-photo" href="' + escapeHtml(photos[i]) + '" target="_blank" rel="noopener">' +
                    '<img src="' + escapeHtml(photos[i]) + '" alt="" loading="lazy" /></a>';
          } else if (notes[i]) {
            html += '<div class="pp-photo-slot pp-photo-note"><span>' + escapeHtml(notes[i]) + "</span></div>";
          } else if (!hasPhoto) {
            html += '<div class="pp-photo-slot"><span>Фото ' + (i + 1) + "</span></div>";
          }
        }
        html += "</div>";
      }
    }

    html += "</div></div>";
    return html;
  }

  function buildOsmPopup(props) {
    props = props || {};
    var title = props.name || props["name:ru"] || "Объект OSM";
    var html = '<div class="feature-popup"><div class="pp-body">';
    html += "<h3>" + escapeHtml(title) + "</h3>";
    var rows = "";
    Object.keys(props).forEach(function (key) {
      if (key.charAt(0) === "@" || key === "name") return;
      var val = props[key];
      if (val === null || val === undefined || val === "") return;
      rows += "<tr><td>" + escapeHtml(key) + "</td><td>" + escapeHtml(val) + "</td></tr>";
    });
    if (rows) html += "<table>" + rows + "</table>";
    html += "</div></div>";
    return html;
  }

  function showPopup(lngLat, html) {
    new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(lngLat).setHTML(html).addTo(map);
  }

  // ============================================================
  //  Тематические слои
  // ============================================================
  var overlay = {}; // id -> control object

  function addSimpleLayer(layerCfg, geojson, pcfg) {
    var srcId = "src-" + layerCfg.id;
    var lyrId = "lyr-" + layerCfg.id;
    var visible = layerCfg.visible !== false;

    map.addSource(srcId, { type: "geojson", data: geojson });
    map.addLayer({
      id: lyrId, type: "circle", source: srcId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        "circle-radius": 7,
        "circle-color": layerCfg.color,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2
      }
    });

    map.on("click", lyrId, function (e) {
      if (measureActive) return;
      var f = e.features[0];
      showPopup(e.lngLat, buildPopupHtml(f.properties, pcfg));
    });
    map.on("mouseenter", lyrId, function () { if (!measureActive) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", lyrId, function () { if (!measureActive) map.getCanvas().style.cursor = ""; });

    (geojson.features || []).forEach(function (feature) {
      if (!feature.geometry || feature.geometry.type !== "Point") return;
      var props = feature.properties || {};
      var name = props[pcfg.titleField];
      if (!name) return;
      var lngLat = feature.geometry.coordinates;
      var html = buildPopupHtml(props, pcfg);
      searchIndex.push({
        name: String(name),
        type: props[pcfg.typeField] || layerCfg.name,
        lngLat: lngLat,
        layerId: layerCfg.id,
        open: function () { showPopup(lngLat, html); }
      });
    });

    overlay[layerCfg.id] = {
      kind: "simple",
      visible: visible,
      setVisible: function (v) {
        this.visible = v;
        map.setLayoutProperty(lyrId, "visibility", v ? "visible" : "none");
      }
    };
  }

  function addCategorizedLayer(layerCfg, geojson, pcfg) {
    var mk = layerCfg.marker;
    var visible = layerCfg.visible !== false;
    var typeGroups = {};   // type -> [markers]
    var enabledTypes = {}; // type -> bool

    (geojson.features || []).forEach(function (feature) {
      if (!feature.geometry || feature.geometry.type !== "Point") return;
      var coords = feature.geometry.coordinates;
      var props = feature.properties || {};
      var type = props[mk.colorField] || "—";
      var color = markerColor(mk, props);

      var popup = new maplibregl.Popup({ offset: (mk.size ? mk.size / 2 : 12), maxWidth: "320px" })
        .setHTML(buildPopupHtml(props, pcfg));
      var marker = new maplibregl.Marker({ element: makeStarEl(color, mk.size), anchor: "center" })
        .setLngLat(coords)
        .setPopup(popup);

      if (!typeGroups[type]) { typeGroups[type] = []; enabledTypes[type] = true; }
      typeGroups[type].push(marker);

      var name = props[pcfg.titleField];
      if (name) {
        searchIndex.push({
          name: String(name), type: type, lngLat: coords, layerId: layerCfg.id,
          open: function () {
            marker.addTo(map);
            if (!marker.getPopup().isOpen()) marker.togglePopup();
          }
        });
      }
    });

    var ctrl = {
      kind: "categorized",
      visible: visible,
      typeGroups: typeGroups,
      enabledTypes: enabledTypes,
      marker: mk,
      setVisible: function (v) {
        this.visible = v;
        Object.keys(typeGroups).forEach(function (t) {
          typeGroups[t].forEach(function (m) {
            if (v && enabledTypes[t] !== false) m.addTo(map); else m.remove();
          });
        });
      },
      setType: function (t, v) {
        enabledTypes[t] = v;
        if (!this.visible) return;
        typeGroups[t].forEach(function (m) { if (v) m.addTo(map); else m.remove(); });
      }
    };
    overlay[layerCfg.id] = ctrl;
    if (visible) ctrl.setVisible(true);
  }

  function loadThematicLayers() {
    return Promise.all(cfg.layers.map(function (layerCfg) {
      return fetch(layerCfg.geojson)
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " для " + layerCfg.geojson); return r.json(); })
        .then(function (geojson) {
          var pcfg = layerCfg.popup || POPUP;
          var categorized = !!(layerCfg.marker && layerCfg.marker.shape === "star" && layerCfg.marker.colors);
          if (categorized) addCategorizedLayer(layerCfg, geojson, pcfg);
          else addSimpleLayer(layerCfg, geojson, pcfg);
        })
        .catch(function (err) {
          console.error("Не удалось загрузить слой", layerCfg.id, err);
          overlay[layerCfg.id] = null;
        });
    }));
  }

  // ============================================================
  //  UI: список тематических слоёв с легендой
  // ============================================================
  function buildLayerControls() {
    var box = document.getElementById("layer-list");
    box.innerHTML = "";
    cfg.layers.forEach(function (layerCfg) {
      var ov = overlay[layerCfg.id];
      var hasLegend = !!(layerCfg.marker && layerCfg.marker.shape === "star" && layerCfg.marker.colors);

      var item = document.createElement("div");
      item.className = "layer-item";

      var row = document.createElement("div");
      row.className = "control-item layer-row";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = ov ? ov.visible : false;
      input.disabled = !ov;
      input.addEventListener("change", function () {
        if (ov) ov.setVisible(input.checked);
      });

      var span = document.createElement("span");
      span.className = "layer-name";
      span.textContent = layerCfg.name + (ov ? "" : " (ошибка загрузки)");

      row.appendChild(input);
      if (!hasLegend) {
        var swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = layerCfg.color;
        row.appendChild(swatch);
      }
      row.appendChild(span);

      if (hasLegend && ov && ov.kind === "categorized") {
        var caret = document.createElement("span");
        caret.className = "legend-caret";
        caret.textContent = "▸";
        row.appendChild(caret);

        var legend = document.createElement("div");
        legend.className = "layer-legend";

        Object.keys(ov.typeGroups).sort().forEach(function (type) {
          var color = (layerCfg.marker.colors && layerCfg.marker.colors[type]) || layerCfg.marker.defaultColor;
          var li = document.createElement("label");
          li.className = "legend-item";

          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = ov.enabledTypes[type] !== false;
          cb.addEventListener("change", function () {
            ov.setType(type, cb.checked);
          });

          var sw = document.createElement("span");
          sw.className = "legend-star";
          sw.innerHTML = starSvg(color, 16);

          var tx = document.createElement("span");
          tx.textContent = type;

          li.appendChild(cb);
          li.appendChild(sw);
          li.appendChild(tx);
          legend.appendChild(li);
        });

        var toggle = function () {
          var open = item.classList.toggle("legend-open");
          caret.textContent = open ? "▾" : "▸";
        };
        span.addEventListener("click", toggle);
        caret.addEventListener("click", toggle);
        span.style.cursor = "pointer";

        item.appendChild(row);
        item.appendChild(legend);
      } else {
        span.addEventListener("click", function () {
          if (!input.disabled) { input.checked = !input.checked; input.dispatchEvent(new Event("change")); }
        });
        item.appendChild(row);
      }

      box.appendChild(item);
    });
  }

  // ============================================================
  //  Поиск
  // ============================================================
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");

  input.addEventListener("input", function () {
    var q = input.value.trim().toLowerCase();
    results.innerHTML = "";
    if (!q) return;
    var matches = searchIndex
      .filter(function (it) { return it.name.toLowerCase().indexOf(q) !== -1; })
      .slice(0, 8);
    matches.forEach(function (it) {
      var li = document.createElement("li");
      li.innerHTML = escapeHtml(it.name) + "<small>" + escapeHtml(it.type) + "</small>";
      li.addEventListener("click", function () {
        var ov = overlay[it.layerId];
        if (ov && !ov.visible) { ov.setVisible(true); buildLayerControls(); }
        map.flyTo({ center: it.lngLat, zoom: Math.max(map.getZoom(), 11) });
        it.open();
        results.innerHTML = "";
        input.value = it.name;
      });
      results.appendChild(li);
    });
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-box")) results.innerHTML = "";
  });

  // ============================================================
  //  Вкладки сайдбара
  // ============================================================
  var tabBtns = document.querySelectorAll(".tab-btn");
  var tabContents = document.querySelectorAll(".tab-content");
  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.getAttribute("data-tab");
      tabBtns.forEach(function (b) { b.classList.toggle("active", b === btn); });
      tabContents.forEach(function (c) {
        c.classList.toggle("active", c.getAttribute("data-tab") === name);
      });
    });
  });

  // ============================================================
  //  Картографическая основа: слои OpenStreetMap через Overpass
  // ============================================================
  var osmCfg = cfg.osmLayers || [];
  var osmEndpoint = cfg.overpassEndpoint || "https://overpass-api.de/api/interpreter";
  var osmState = {}; // id -> {enabled, statusEl, controller, added}

  function osmLayerDefs(layerCfg) {
    var src = "osmsrc-" + layerCfg.id;
    var color = layerCfg.color;
    if (layerCfg.geom === "line") {
      return [{ id: "osmline-" + layerCfg.id, type: "line", source: src,
        paint: { "line-color": color, "line-width": 2, "line-opacity": 0.9 } }];
    }
    if (layerCfg.geom === "polygon") {
      return [
        { id: "osmfill-" + layerCfg.id, type: "fill", source: src,
          paint: { "fill-color": color, "fill-opacity": 0.25 } },
        { id: "osmline-" + layerCfg.id, type: "line", source: src,
          paint: { "line-color": color, "line-width": 1, "line-opacity": 0.9 } }
      ];
    }
    return [{ id: "osmcirc-" + layerCfg.id, type: "circle", source: src,
      paint: { "circle-radius": 6, "circle-color": color, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } }];
  }

  function ensureOsmLayers(layerCfg) {
    var src = "osmsrc-" + layerCfg.id;
    if (map.getSource(src)) return;
    map.addSource(src, { type: "geojson", data: EMPTY_FC });
    osmLayerDefs(layerCfg).forEach(function (def) {
      map.addLayer(def);
      map.on("click", def.id, function (e) {
        if (measureActive) return;
        showPopup(e.lngLat, buildOsmPopup(e.features[0].properties));
      });
      map.on("mouseenter", def.id, function () { if (!measureActive) map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", def.id, function () { if (!measureActive) map.getCanvas().style.cursor = ""; });
    });
  }

  function removeOsmLayers(layerCfg) {
    var src = "osmsrc-" + layerCfg.id;
    osmLayerDefs(layerCfg).forEach(function (def) {
      if (map.getLayer(def.id)) map.removeLayer(def.id);
    });
    if (map.getSource(src)) map.removeSource(src);
  }

  function setOsmStatus(layerCfg, text) {
    var st = osmState[layerCfg.id];
    if (st && st.statusEl) st.statusEl.textContent = text ? "— " + text : "";
  }

  function fetchOsmLayer(layerCfg) {
    var st = osmState[layerCfg.id];
    if (!st || !st.enabled) return;
    var src = map.getSource("osmsrc-" + layerCfg.id);
    if (!src) return;

    if (map.getZoom() < layerCfg.minZoom) {
      src.setData(EMPTY_FC);
      setOsmStatus(layerCfg, "приблизьте (зум " + layerCfg.minZoom + "+)");
      return;
    }

    var b = map.getBounds();
    var bbox = b.getSouth().toFixed(5) + "," + b.getWest().toFixed(5) + "," +
               b.getNorth().toFixed(5) + "," + b.getEast().toFixed(5);
    var ql = "[out:json][timeout:30][bbox:" + bbox + "];(" + layerCfg.query.join("") + ");out geom;";

    if (st.controller) st.controller.abort();
    st.controller = ("AbortController" in window) ? new AbortController() : null;

    setOsmStatus(layerCfg, "загрузка…");
    fetch(osmEndpoint, {
      method: "POST",
      body: "data=" + encodeURIComponent(ql),
      signal: st.controller ? st.controller.signal : undefined
    })
      .then(function (r) { if (!r.ok) throw new Error("Overpass HTTP " + r.status); return r.json(); })
      .then(function (osm) {
        if (!st.enabled) return;
        var geojson = window.osmtogeojson(osm);
        var s = map.getSource("osmsrc-" + layerCfg.id);
        if (s) s.setData(geojson);
        setOsmStatus(layerCfg, (geojson.features ? geojson.features.length : 0) + " об.");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        console.error("OSM слой", layerCfg.id, err);
        setOsmStatus(layerCfg, "ошибка загрузки");
      });
  }

  function buildOsmControls() {
    var box = document.getElementById("osm-layer-list");
    if (!box) return;
    box.innerHTML = "";
    osmCfg.forEach(function (layerCfg) {
      osmState[layerCfg.id] = { enabled: false, statusEl: null, controller: null };

      var label = document.createElement("label");
      label.className = "control-item";

      var inp = document.createElement("input");
      inp.type = "checkbox";
      inp.addEventListener("change", function () {
        var st = osmState[layerCfg.id];
        st.enabled = inp.checked;
        if (inp.checked) {
          ensureOsmLayers(layerCfg);
          fetchOsmLayer(layerCfg);
        } else {
          if (st.controller) st.controller.abort();
          removeOsmLayers(layerCfg);
          setOsmStatus(layerCfg, "");
        }
      });

      var swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = layerCfg.color;
      if (layerCfg.geom === "line") { swatch.style.borderRadius = "2px"; swatch.style.height = "4px"; }

      var span = document.createElement("span");
      span.textContent = layerCfg.name;

      var status = document.createElement("small");
      status.className = "osm-item-status";

      label.appendChild(inp);
      label.appendChild(swatch);
      label.appendChild(span);
      label.appendChild(status);
      box.appendChild(label);

      osmState[layerCfg.id].statusEl = status;
    });
  }

  // ============================================================
  //  Инструмент измерений (расстояние / площадь) на Turf.js
  // ============================================================
  function setupMeasure() {
    map.addSource("measure", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "measure-fill", type: "fill", source: "measure",
      filter: ["==", "$type", "Polygon"],
      paint: { "fill-color": "#f0883e", "fill-opacity": 0.15 }
    });
    map.addLayer({
      id: "measure-line", type: "line", source: "measure",
      filter: ["==", "$type", "LineString"],
      paint: { "line-color": "#f0883e", "line-width": 3 }
    });
    map.addLayer({
      id: "measure-pts", type: "circle", source: "measure",
      filter: ["==", "$type", "Point"],
      paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": "#f0883e", "circle-stroke-width": 2 }
    });

    var pts = [];
    var readout = document.createElement("div");
    readout.className = "measure-readout";
    readout.style.display = "none";
    document.getElementById("map").appendChild(readout);

    function fmtLen(km) {
      return km < 1 ? (km * 1000).toFixed(0) + " м" : km.toFixed(2) + " км";
    }
    function fmtArea(m2) {
      return m2 < 1e6 ? m2.toFixed(0) + " м²" : (m2 / 1e6).toFixed(2) + " км²";
    }

    function refresh() {
      var feats = pts.map(function (p) { return { type: "Feature", geometry: { type: "Point", coordinates: p } }; });
      if (pts.length >= 2) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts } });
      if (pts.length >= 3) {
        feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [pts.concat([pts[0]])] } });
      }
      map.getSource("measure").setData({ type: "FeatureCollection", features: feats });

      if (pts.length >= 2) {
        var km = turf.length(turf.lineString(pts), { units: "kilometers" });
        var txt = "Длина: <b>" + fmtLen(km) + "</b>";
        if (pts.length >= 3) {
          var area = turf.area(turf.polygon([pts.concat([pts[0]])]));
          txt += " · Площадь: <b>" + fmtArea(area) + "</b>";
        }
        readout.innerHTML = txt + "<br><small>клик — точка · двойной клик — сброс</small>";
      } else {
        readout.innerHTML = "Кликайте по карте, чтобы измерить.<br><small>двойной клик — сброс</small>";
      }
      readout.style.display = "block";
    }

    function onClick(e) { pts.push([e.lngLat.lng, e.lngLat.lat]); refresh(); }
    function onDbl(e) { e.preventDefault(); pts = []; map.getSource("measure").setData(EMPTY_FC); refresh(); }

    var btn;
    function activate(on) {
      measureActive = on;
      if (btn) btn.classList.toggle("active", on);
      if (on) {
        map.getCanvas().style.cursor = "crosshair";
        map.on("click", onClick);
        map.on("dblclick", onDbl);
        map.doubleClickZoom.disable();
        pts = [];
        refresh();
      } else {
        map.getCanvas().style.cursor = "";
        map.off("click", onClick);
        map.off("dblclick", onDbl);
        map.doubleClickZoom.enable();
        pts = [];
        map.getSource("measure").setData(EMPTY_FC);
        readout.style.display = "none";
      }
    }

    function MeasureControl() {}
    MeasureControl.prototype.onAdd = function () {
      var c = document.createElement("div");
      c.className = "maplibregl-ctrl maplibregl-ctrl-group";
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "measure-btn";
      btn.title = "Измерить расстояние / площадь";
      btn.textContent = "📏";
      btn.addEventListener("click", function () { activate(!measureActive); });
      c.appendChild(btn);
      this._container = c;
      return c;
    };
    MeasureControl.prototype.onRemove = function () {
      if (this._container && this._container.parentNode) this._container.parentNode.removeChild(this._container);
    };
    map.addControl(new MeasureControl(), "top-right");
  }

  // ============================================================
  //  Инициализация после загрузки карты
  // ============================================================
  map.on("load", function () {
    loadThematicLayers().then(buildLayerControls);
    buildOsmControls();
    setupMeasure();

    var osmMoveTimer = null;
    map.on("moveend", function () {
      if (osmMoveTimer) clearTimeout(osmMoveTimer);
      osmMoveTimer = setTimeout(function () {
        osmCfg.forEach(function (layerCfg) {
          if (osmState[layerCfg.id] && osmState[layerCfg.id].enabled) fetchOsmLayer(layerCfg);
        });
      }, 700);
    });
  });
})();
