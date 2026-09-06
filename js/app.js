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
  // Стартовый охват — весь Камчатский край
  if (cfg.map.bounds) {
    map.fitBounds(cfg.map.bounds, { padding: 20, animate: false });
  }
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
  function buildPopupHtml(props, pcfg, coords) {
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

    // Блок геологии (данные из геологической карты)
    if (pcfg.geoBlock) {
      var gb = pcfg.geoBlock;
      var gIdx = props[gb.indexField];
      var gUnit = props[gb.unitField];
      var gGroup = gb.groupField ? props[gb.groupField] : "";
      var has = function (v) { return v !== undefined && v !== null && v !== ""; };
      if (has(gIdx) || has(gUnit) || has(gGroup)) {
        html += '<div class="pp-geo"><span class="pp-geo-title">' +
                escapeHtml(gb.title || "Геология (по карте)") + "</span>";
        if (has(gGroup)) html += '<div class="pp-geo-row"><span class="pp-geo-label">Подразделение:</span> ' + escapeHtml(gGroup) + "</div>";
        if (has(gUnit)) html += '<div class="pp-geo-row"><span class="pp-geo-label">Описание (rus):</span> ' + escapeHtml(gUnit) + "</div>";
        if (has(gIdx)) html += '<div class="pp-geo-row"><span class="pp-geo-label">Индекс:</span> <b>' + escapeHtml(gIdx) + "</b></div>";
        html += "</div>";
      }
    }

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

    // Кнопка прокладки маршрута к точке
    if (coords && coords.length >= 2) {
      html += '<button type="button" class="pp-route-btn" ' +
              'data-lng="' + Number(coords[0]) + '" data-lat="' + Number(coords[1]) + '" ' +
              'data-name="' + escapeHtml(title || "") + '">🧭 Проложить маршрут сюда</button>';
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

    // Категоризированный круговой слой: цвет зависит от поля colorField
    var mk = layerCfg.marker;
    var catCircle = !!(mk && mk.colors && mk.colorField && mk.shape !== "star");
    var circleColor = layerCfg.color;
    var presentTypes = {};
    if (catCircle) {
      var expr = ["match", ["get", mk.colorField]];
      Object.keys(mk.colors).forEach(function (k) { expr.push(k, mk.colors[k]); });
      expr.push(mk.defaultColor || layerCfg.color);
      circleColor = expr;
      (geojson.features || []).forEach(function (f) {
        var v = (f.properties || {})[mk.colorField];
        if (v !== undefined && v !== null && v !== "") presentTypes[v] = true;
      });
    }

    map.addSource(srcId, { type: "geojson", data: geojson });
    map.addLayer({
      id: lyrId, type: "circle", source: srcId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        "circle-radius": 7,
        "circle-color": circleColor,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2
      }
    });

    map.on("click", lyrId, function (e) {
      if (measureActive) return;
      var f = e.features[0];
      var c = (f.geometry && f.geometry.coordinates) || [e.lngLat.lng, e.lngLat.lat];
      showPopup(e.lngLat, buildPopupHtml(f.properties, pcfg, c));
    });
    map.on("mouseenter", lyrId, function () { if (!measureActive) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", lyrId, function () { if (!measureActive) map.getCanvas().style.cursor = ""; });

    (geojson.features || []).forEach(function (feature) {
      if (!feature.geometry || feature.geometry.type !== "Point") return;
      var props = feature.properties || {};
      var name = props[pcfg.titleField];
      if (!name) return;
      var lngLat = feature.geometry.coordinates;
      var html = buildPopupHtml(props, pcfg, lngLat);
      searchIndex.push({
        name: String(name),
        type: props[pcfg.typeField] || layerCfg.name,
        lngLat: lngLat,
        layerId: layerCfg.id,
        open: function () { showPopup(lngLat, html); }
      });
    });

    if (catCircle) {
      overlay[layerCfg.id] = {
        kind: "circleCat",
        visible: visible,
        colorField: mk.colorField,
        colors: mk.colors,
        types: Object.keys(presentTypes).sort(),
        enabledTypes: {},
        setVisible: function (v) {
          this.visible = v;
          map.setLayoutProperty(lyrId, "visibility", v ? "visible" : "none");
        },
        setType: function (t, v) {
          this.enabledTypes[t] = v;
          var enabled = this.types.filter(function (x) { return this.enabledTypes[x] !== false; }, this);
          if (enabled.length === this.types.length) {
            map.setFilter(lyrId, null);
          } else {
            map.setFilter(lyrId, ["match", ["get", this.colorField], enabled.length ? enabled : ["\u0000"], true, false]);
          }
        }
      };
      overlay[layerCfg.id].types.forEach(function (t) { overlay[layerCfg.id].enabledTypes[t] = true; });
    } else {
      overlay[layerCfg.id] = {
        kind: "simple",
        visible: visible,
        setVisible: function (v) {
          this.visible = v;
          map.setLayoutProperty(lyrId, "visibility", v ? "visible" : "none");
        }
      };
    }
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
        .setHTML(buildPopupHtml(props, pcfg, coords));
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

  // Авто-палитра различимых цветов (золотой угол по тону)
  function genPalette(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var h = Math.round((i * 137.508) % 360);
      var l = 45 + (i % 3) * 8; // лёгкая вариация светлоты
      out.push("hsl(" + h + ", 62%, " + l + "%)");
    }
    return out;
  }

  function buildPolyPopup(props, pcfg, title) {
    var labels = (pcfg && pcfg.fieldLabels) || {};
    var html = '<div class="feature-popup"><div class="pp-body">';
    html += "<h3>" + escapeHtml(title) + "</h3><table>";
    Object.keys(props).forEach(function (key) {
      var val = props[key];
      if (val === null || val === undefined || val === "" || val === -9999) return;
      var label = labels[key] || key;
      html += "<tr><td>" + escapeHtml(label) + "</td><td>" + escapeHtml(val) + "</td></tr>";
    });
    html += "</table></div></div>";
    return html;
  }

  function addPolygonLayer(layerCfg, geojson, pcfg) {
    var srcId = "src-" + layerCfg.id;
    var fillId = "lyr-" + layerCfg.id + "-fill";
    var lineId = "lyr-" + layerCfg.id + "-line";
    var visible = layerCfg.visible !== false;
    var mk = layerCfg.marker || {};
    var field = mk.colorField;

    // Категории и палитра
    var present = {};
    (geojson.features || []).forEach(function (f) {
      var v = (f.properties || {})[field];
      if (v !== undefined && v !== null && v !== "") present[v] = true;
    });
    var types;
    if (mk.colors && Object.keys(mk.colors).length) {
      // Порядок легенды — как в конфиге (напр., хронологический), только присутствующие
      types = Object.keys(mk.colors).filter(function (k) { return present[k]; });
      Object.keys(present).forEach(function (k) { if (types.indexOf(k) === -1) types.push(k); });
    } else {
      types = Object.keys(present).map(function (k) {
        var n = Number(k);
        return isNaN(n) ? k : n;
      }).sort(function (a, b) { return a > b ? 1 : a < b ? -1 : 0; });
    }

    var palette = (mk.colors && Object.keys(mk.colors).length) ? null : genPalette(types.length);
    var colors = {};
    types.forEach(function (t, i) {
      colors[t] = (mk.colors && mk.colors[t]) || (palette ? palette[i] : (mk.defaultColor || "#888888"));
    });

    var fillColor = ["match", ["get", field]];
    types.forEach(function (t) { fillColor.push(t, colors[t]); });
    fillColor.push(mk.defaultColor || "#888888");

    map.addSource(srcId, { type: "geojson", data: geojson });
    map.addLayer({
      id: fillId, type: "fill", source: srcId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: { "fill-color": fillColor, "fill-opacity": mk.fillOpacity != null ? mk.fillOpacity : 0.55 }
    });
    map.addLayer({
      id: lineId, type: "line", source: srcId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: { "line-color": "#ffffff", "line-width": 0.6, "line-opacity": 0.7 }
    });

    var titleField = (pcfg && pcfg.titleField) || "POLIGON_ID";
    map.on("click", fillId, function (e) {
      if (measureActive) return;
      var p = e.features[0].properties;
      var title = (layerCfg.name || "Полигон") + (p[titleField] != null ? " #" + p[titleField] : "");
      showPopup(e.lngLat, buildPolyPopup(p, pcfg, title));
    });
    map.on("mouseenter", fillId, function () { if (!measureActive) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", fillId, function () { if (!measureActive) map.getCanvas().style.cursor = ""; });

    var ctrl = {
      kind: "polyCat",
      visible: visible,
      colorField: field,
      colors: colors,
      types: types,
      legendPrefix: mk.legendPrefix || "",
      enabledTypes: {},
      setVisible: function (v) {
        this.visible = v;
        map.setLayoutProperty(fillId, "visibility", v ? "visible" : "none");
        map.setLayoutProperty(lineId, "visibility", v ? "visible" : "none");
      },
      setType: function (t, v) {
        this.enabledTypes[t] = v;
        var en = this.types.filter(function (x) { return this.enabledTypes[x] !== false; }, this);
        var filter = en.length === this.types.length ? null
          : ["match", ["get", this.colorField], en.length ? en : ["\u0000"], true, false];
        map.setFilter(fillId, filter);
        map.setFilter(lineId, filter);
      }
    };
    types.forEach(function (t) { ctrl.enabledTypes[t] = true; });
    overlay[layerCfg.id] = ctrl;
  }

  function loadThematicLayers() {
    return Promise.all(cfg.layers.map(function (layerCfg) {
      return fetch(layerCfg.geojson)
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " для " + layerCfg.geojson); return r.json(); })
        .then(function (geojson) {
          var pcfg = layerCfg.popup || POPUP;
          var categorized = !!(layerCfg.marker && layerCfg.marker.shape === "star" && layerCfg.marker.colors);
          if (layerCfg.geom === "polygon") addPolygonLayer(layerCfg, geojson, pcfg);
          else if (categorized) addCategorizedLayer(layerCfg, geojson, pcfg);
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
      var hasLegend = !!(layerCfg.marker && (layerCfg.marker.colors || layerCfg.marker.colorField));
      var isStar = layerCfg.marker && layerCfg.marker.shape === "star";

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

      if (hasLegend && ov && (ov.kind === "categorized" || ov.kind === "circleCat" || ov.kind === "polyCat")) {
        var caret = document.createElement("span");
        caret.className = "legend-caret";
        caret.textContent = "▸";
        row.appendChild(caret);

        var legend = document.createElement("div");
        legend.className = "layer-legend";

        var types = ov.kind === "categorized" ? Object.keys(ov.typeGroups).sort() : ov.types;
        types.forEach(function (type) {
          var color = (ov.colors && ov.colors[type]) || (layerCfg.marker.colors && layerCfg.marker.colors[type]) || layerCfg.marker.defaultColor;
          var li = document.createElement("label");
          li.className = "legend-item";

          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = ov.enabledTypes[type] !== false;
          cb.addEventListener("change", function () {
            ov.setType(type, cb.checked);
          });

          var sw = document.createElement("span");
          if (isStar) {
            sw.className = "legend-star";
            sw.innerHTML = starSvg(color, 16);
          } else {
            sw.className = "swatch";
            sw.style.background = color;
          }

          var tx = document.createElement("span");
          tx.textContent = (ov.legendPrefix || "") + type;

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
  //  Прокладка маршрутов (BRouter — бесплатно, без ключа)
  //  Даёт геометрию + теги дорог (surface/highway) и профили авто/пешком
  // ============================================================
  var BROUTER_URL = "https://brouter.de/brouter";
  var BROUTER_PROFILE = { car: "car-fast", track: "trekking", foot: "hiking-mountain" };
  var PETROPAVLOVSK = [158.6505, 53.0195];
  var routeState = {
    origin: null, originLabel: "", dest: null, destName: "", pickMode: false, mode: "car", lastResult: null,
    // Спешивание на «неизвестном» участке: геометрия участка, время езды по дорогам, точка спешивания
    unknownCoords: null, driveTimes: null, dismount: null, pickDismount: false, lastFeatures: []
  };
  var routePanel = null;

  // Классификация покрытия дороги → фаза маршрута
  var UNKNOWN_PHASE = "Неизвестный маршрут"; // участок без дорог в OSM: пешком или, возможно, на вездеходе
  // Все дорожные сегменты — ОДНИМ цветом (разделение по покрытию убрано по просьбе);
  // классификация фаз остаётся — она нужна для расчёта времени по VEHICLE_SPEED
  var ROAD_COLOR = "#1a73e8";
  var PHASE_COLORS = {
    "Хорошая дорога": ROAD_COLOR,
    "Гравийная трасса": ROAD_COLOR,
    "Просёлок": ROAD_COLOR
  };
  PHASE_COLORS[UNKNOWN_PHASE] = "#2e9e4f";
  var PHASE_ORDER = ["Хорошая дорога", "Гравийная трасса", "Просёлок", UNKNOWN_PHASE];
  // Время до цели считаем для двух типичных видов транспорта Камчатки:
  //  - Вахтовка (КамАЗ/ГАЗ-66/Урал): быстрее на трассе, медленнее на внедорожных треках;
  //  - Вездеход (гусеничный/ШЕРП/ТРЭКОЛ): медленнее по асфальту, увереннее на бездорожье.
  // Скорости (м/с) по типу покрытия, откалиброваны по отчётам туристов:
  //  - ПКЦ→Козыревск на вахтовке: 470–500 км (асфальт+гравий) — 7–9 ч;
  //  - Козыревск→«Клешня» на вахтовке: 70 км лесной дороги с бродами — 3–5 ч.
  var VEHICLE_ORDER = ["Вахтовка", "Вездеход"];
  var VEHICLE_ICONS = { "Вахтовка": "🚛", "Вездеход": "🚜" };
  VEHICLE_ICONS[UNKNOWN_PHASE] = "❓";
  var VEHICLE_COLORS = { "Вахтовка": ROAD_COLOR, "Вездеход": ROAD_COLOR };
  VEHICLE_COLORS[UNKNOWN_PHASE] = "#2e9e4f";
  // «Неизвестный маршрут» (нет дорог в OSM) по факту проезжается тем же транспортом
  // (вахтовки доезжают даже до кратеров типа Южной Звезды) — время оцениваем
  // как по внедорожному треку.
  var VEHICLE_SPEED = {
    "Вахтовка": {
      "Хорошая дорога": 60 / 3.6,   // асфальтовая трасса с посёлками
      "Гравийная трасса": 45 / 3.6, // отсыпка типа Мильково–Ключи
      "Просёлок": 15 / 3.6          // внедорожный трек, броды, шлак
    },
    "Вездеход": {
      "Хорошая дорога": 40 / 3.6,   // по асфальту вездеход медленнее вахтовки
      "Гравийная трасса": 30 / 3.6,
      "Просёлок": 12 / 3.6          // зато уверенно идёт там, где вахтовка буксует
    }
  };
  VEHICLE_SPEED["Вахтовка"][UNKNOWN_PHASE] = 15 / 3.6;
  VEHICLE_SPEED["Вездеход"][UNKNOWN_PHASE] = 12 / 3.6;
  // Пеший вариант преодоления «неизвестного» участка (если машина не пройдёт):
  var FOOT_SPEED = 4 / 3.6;     // ~4 км/ч по ровному
  var NAISMITH_SEC_PER_M = 6;   // правило Наисмита: +1 ч на каждые 600 м набора высоты
  function footTime(distMeters, ascentMeters) {
    return distMeters / FOOT_SPEED + (ascentMeters || 0) * NAISMITH_SEC_PER_M;
  }
  var routeReq = 0;      // счётчик запросов (игнор устаревших ответов)

  function surfaceFromTags(tags) {
    tags = tags || "";
    var sm = /surface=([^\s]+)/.exec(tags);
    var s = sm ? sm[1] : "";
    var hm = /highway=([^\s]+)/.exec(tags);
    var h = hm ? hm[1] : "";
    var majorRoad = /(motorway|trunk|primary|secondary|tertiary)/.test(h);
    if (/(asphalt|paved|concrete|paving_stones|sett|cobblestone|metal|wood|chipseal)/.test(s)) return "hard";
    if (s) return majorRoad ? "grade" : "soft"; // грунт/гравий: на трассе — отсыпка, иначе просёлок
    if (majorRoad || /(residential|living_street|unclassified|service)/.test(h)) return "hard";
    return "soft";
  }
  function classifyDrivePhase(surf) {
    if (surf === "hard") return "Хорошая дорога";
    if (surf === "grade") return "Гравийная трасса";
    return "Просёлок";
  }

  function setupRouting() {
    map.addSource("route", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "route-halo", type: "line", source: "route",
      filter: ["==", ["get", "kind"], "seg"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.75 }
    });
    // Проезжие сегменты: сплошная линия единого цвета
    map.addLayer({
      id: "route-drive", type: "line", source: "route",
      filter: ["all", ["==", ["get", "kind"], "seg"], ["==", ["get", "segType"], "drive"]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ROAD_COLOR, "line-width": 5 }
    });
    // Пеший сегмент: зелёный пунктир
    map.addLayer({
      id: "route-foot", type: "line", source: "route",
      filter: ["all", ["==", ["get", "kind"], "seg"], ["==", ["get", "segType"], "foot"]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": PHASE_COLORS[UNKNOWN_PHASE], "line-width": 4, "line-dasharray": [1.5, 1.2] }
    });
    map.addLayer({
      id: "route-straight", type: "line", source: "route",
      filter: ["==", ["get", "kind"], "straight"],
      paint: { "line-color": "#e8453c", "line-width": 3, "line-dasharray": [2, 2] }
    });
    map.addLayer({
      id: "route-ends", type: "circle", source: "route",
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": 6,
        "circle-color": ["match", ["get", "role"], "origin", "#34a853", "dest", "#e8453c", "dismount", "#f0883e", "#888888"],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 2
      }
    });

    routePanel = document.createElement("div");
    routePanel.className = "route-panel";
    routePanel.style.display = "none";
    document.getElementById("map").appendChild(routePanel);

    map.on("click", function (e) {
      if (routeState.pickDismount) {
        routeState.pickDismount = false;
        map.getCanvas().style.cursor = "";
        setDismount([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if (!routeState.pickMode) return;
      routeState.pickMode = false;
      map.getCanvas().style.cursor = "";
      setOrigin([e.lngLat.lng, e.lngLat.lat], "Точка на карте");
      computeRoute();
    });
  }

  function startRouteTo(lng, lat, name) {
    routeState.dest = [lng, lat];
    routeState.destName = name || "Точка";
    routePanel.style.display = "block";
    renderRoutePanel();
    if (routeState.origin) computeRoute();
    else geolocateOrigin();
  }

  function setOrigin(lngLat, label) {
    routeState.origin = lngLat;
    routeState.originLabel = label || "Старт";
    renderRoutePanel();
  }

  function geolocateOrigin() {
    if (!navigator.geolocation) {
      renderRoutePanel("Геолокация недоступна — выберите старт вручную.");
      return;
    }
    renderRoutePanel("Определяю ваше местоположение…");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        setOrigin([pos.coords.longitude, pos.coords.latitude], "Моё местоположение");
        computeRoute();
      },
      function () { renderRoutePanel("Не удалось определить местоположение — выберите старт вручную."); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function fmtDist(m) { return m < 1000 ? Math.round(m) + " м" : (m / 1000).toFixed(1) + " км"; }
  function fmtDur(s) {
    var min = Math.round(s / 60);
    if (min < 1) return "<1 мин";
    if (min < 60) return min + " мин";
    return Math.floor(min / 60) + " ч " + (min % 60) + " мин";
  }
  function distM(a, b) { return turf.distance(turf.point(a), turf.point(b), { units: "kilometers" }) * 1000; }

  // Разбор BRouter messages → сегменты [{dist, surf}] (теги покрытия + длина)
  function parseSegs(messages) {
    var segs = [];
    if (messages && messages.length > 1) {
      var h = messages[0];
      var iT = h.indexOf("WayTags"), iD = h.indexOf("Distance");
      for (var i = 1; i < messages.length; i++) {
        var dist = parseFloat(messages[i][iD]) || 0;
        segs.push({ dist: dist, surf: surfaceFromTags(iT >= 0 ? messages[i][iT] : "") });
      }
    }
    return segs;
  }

  // Время (сек) для конкретного транспорта по расстоянию (м) и типу покрытия
  function vehicleTime(distMeters, phase, vehicle) {
    var tab = VEHICLE_SPEED[vehicle];
    var v = tab[phase] || tab["Просёлок"];
    return distMeters / v;
  }

  // Суммарный набор высоты (м) по координатам трека BRouter ([lon,lat,ele])
  function computeAscent(coords) {
    var up = 0;
    for (var i = 1; i < coords.length; i++) {
      var z0 = coords[i - 1][2], z1 = coords[i][2];
      if (typeof z0 === "number" && typeof z1 === "number" && z1 > z0) up += z1 - z0;
    }
    return up;
  }

  // Строит геометрию по фазам + статистику {phase:{dist}} для одного «плеча»
  function buildLeg(coords, messages, classifyFn, segType) {
    var segs = parseSegs(messages);
    var stats = {};
    var ends = [], cum = 0;
    segs.forEach(function (s) {
      cum += s.dist; ends.push(cum);
      var ph = classifyFn(s.surf);
      if (!stats[ph]) stats[ph] = { dist: 0 };
      stats[ph].dist += s.dist;
    });

    var feats = [];
    var geomCum = 0, si = 0, curPh = null, curCoords = null;
    for (var k = 0; k < coords.length - 1; k++) {
      var a = coords[k], b = coords[k + 1];
      var dd = distM(a, b);
      var mid = geomCum + dd / 2;
      while (ends.length && si < ends.length - 1 && ends[si] < mid) si++;
      var ph = segs.length ? classifyFn(segs[si].surf) : (segType === "foot" ? UNKNOWN_PHASE : "Просёлок");
      if (ph !== curPh) {
        if (curCoords) feats.push({ type: "Feature", properties: { kind: "seg", segType: segType, phase: curPh }, geometry: { type: "LineString", coordinates: curCoords } });
        curPh = ph; curCoords = [a];
      }
      curCoords.push(b);
      geomCum += dd;
    }
    if (curCoords) feats.push({ type: "Feature", properties: { kind: "seg", segType: segType, phase: curPh }, geometry: { type: "LineString", coordinates: curCoords } });
    return { features: feats, stats: stats };
  }

  function mergeStats(dst, src) {
    Object.keys(src).forEach(function (p) {
      if (!dst[p]) dst[p] = { dist: 0 };
      dst[p].dist += src[p].dist;
    });
  }

  function setRouteFeatures(features) {
    routeState.lastFeatures = features;
    var pts = [
      { type: "Feature", properties: { role: "origin" }, geometry: { type: "Point", coordinates: routeState.origin } },
      { type: "Feature", properties: { role: "dest" }, geometry: { type: "Point", coordinates: routeState.dest } }
    ];
    if (routeState.dismount) {
      pts.push({ type: "Feature", properties: { role: "dismount" }, geometry: { type: "Point", coordinates: routeState.dismount.coord } });
    }
    map.getSource("route").setData({ type: "FeatureCollection", features: features.concat(pts) });
  }

  // Точка спешивания: привязываем клик к ближайшей вершине «неизвестного» участка
  // и считаем: на транспорте до точки + пешком от точки до цели (с набором высоты)
  function setDismount(lngLat) {
    var cs = routeState.unknownCoords;
    if (!cs || cs.length < 2) return;
    var best = 0, bd = Infinity;
    for (var i = 0; i < cs.length; i++) {
      var d = distM(lngLat, cs[i]);
      if (d < bd) { bd = d; best = i; }
    }
    var distTo = 0, distRem = 0;
    for (var k = 1; k < cs.length; k++) {
      var dd = distM(cs[k - 1], cs[k]);
      if (k <= best) distTo += dd; else distRem += dd;
    }
    var ascentRem = computeAscent(cs.slice(best));
    var walk = footTime(distRem, ascentRem);
    var vehTimes = {};
    VEHICLE_ORDER.forEach(function (veh) {
      var driveT = (routeState.driveTimes && routeState.driveTimes[veh]) || 0;
      vehTimes[veh] = driveT + distTo / VEHICLE_SPEED[veh][UNKNOWN_PHASE];
    });
    routeState.dismount = {
      coord: cs[best].slice(0, 2), distTo: distTo, distRem: distRem,
      ascentRem: ascentRem, walkTime: walk, vehTimes: vehTimes
    };
    setRouteFeatures(routeState.lastFeatures);
    renderRoutePanel();
  }

  function clearDismount(rerender) {
    routeState.dismount = null;
    routeState.pickDismount = false;
    if (rerender) {
      setRouteFeatures(routeState.lastFeatures);
      renderRoutePanel();
    }
  }

  function fitRoute(coords) {
    var b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    coords.forEach(function (c) { b.extend(c); });
    map.fitBounds(b, { padding: 70, maxZoom: 13, duration: 700 });
  }

  // Запрос одного плеча к BRouter → {coords, messages, totalTime, totalLen} | null
  function brouter(a, b, mode) {
    var url = BROUTER_URL + "?lonlats=" + a[0] + "," + a[1] + "|" + b[0] + "," + b[1] +
              "&profile=" + BROUTER_PROFILE[mode] + "&alternativeidx=0&format=geojson";
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (gj) {
        var f = gj && gj.features && gj.features[0];
        if (!f || !f.geometry || f.geometry.type !== "LineString" || f.geometry.coordinates.length < 2) return null;
        var p = f.properties || {};
        return {
          coords: f.geometry.coordinates, messages: p.messages,
          totalTime: parseFloat(p["total-time"]) || null, totalLen: parseFloat(p["track-length"]) || null
        };
      })
      .catch(function () { return null; });
  }

  // Мультимодальный маршрут: авто как можно БЛИЖЕ к цели, затем пешком/напрямую.
  // ВАЖНО: раньше при неудаче авто-маршрута весь путь строился пешим профилем —
  // BRouter уводил трек по тропам за сотни км (кривые маршруты). Теперь:
  //  1) авто прямо до цели; если нет — подбор ближайшей достижимой точки (carApproach);
  //  2) пеший финал проверяется на адекватность (footSane), иначе прямой отрезок.
  function computeRoute() {
    if (!routeState.origin || !routeState.dest) return;
    var reqId = ++routeReq;
    var o = routeState.origin, d = routeState.dest;
    routeState.unknownCoords = null;
    routeState.driveTimes = null;
    clearDismount(false);
    renderRoutePanel("Прокладываю маршрут…");
    driveTo(o, d).then(function (car) {
      if (reqId !== routeReq) return;
      if (car) { finishWithCar(reqId, car, d); return; }
      // Цель не привязалась к дороге у BRouter — ищем ближайшую точку РЕАЛЬНОЙ
      // дороги через Overpass и едем именно туда (по основной трассе)
      nearestRoadPoint(d).then(function (roadPt) {
        if (reqId !== routeReq) return;
        if (roadPt) {
          driveTo(o, roadPt).then(function (car2) {
            if (reqId !== routeReq) return;
            if (car2) { finishWithCar(reqId, car2, d); return; }
            carApproach(reqId, o, d, APPROACH_FRACS);
          });
        } else {
          carApproach(reqId, o, d, APPROACH_FRACS);
        }
      });
    }).catch(function () { if (reqId === routeReq) straightFallback(); });
  }

  var APPROACH_FRACS = [0.9, 0.7, 0.45];

  // Авто-плечо: сначала авто-профиль; если он отказал (паром, грунтовки — как дорога
  // Козыревск→Ключи) — профиль trekking: идёт по тем же дорогам, но разрешает паромы
  // и любые покрытия. Время всё равно считаем сами по тегам покрытия (VEHICLE_SPEED).
  function driveTo(a, b) {
    return brouter(a, b, "car").then(function (car) {
      return car || brouter(a, b, "track");
    });
  }

  // Ближайшая к точке вершина проезжей дороги (из OSM через Overpass, радиус 15 км)
  function nearestRoadPoint(pt) {
    var q = "[out:json][timeout:10];way(around:15000," + pt[1] + "," + pt[0] +
            ')["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|road)$"];out geom;';
    return fetch(osmEndpoint, { method: "POST", body: "data=" + encodeURIComponent(q) })
      .then(function (r) { return r.json(); })
      .then(function (osm) {
        var best = null, bd = Infinity;
        (osm.elements || []).forEach(function (el) {
          (el.geometry || []).forEach(function (g) {
            var dd = distM(pt, [g.lon, g.lat]);
            if (dd < bd) { bd = dd; best = [g.lon, g.lat]; }
          });
        });
        return best;
      })
      .catch(function () { return null; });
  }

  // Подбор ближайшей к цели точки, достижимой на авто
  function carApproach(reqId, o, d, fracs) {
    if (reqId !== routeReq) return;
    if (!fracs.length) {
      // На авто не доехать вовсе: короткие маршруты пробуем пешим профилем, иначе прямая
      if (distM(o, d) <= 30000) {
        brouter(o, d, "foot").then(function (foot) {
          if (reqId !== routeReq) return;
          if (foot && footSane(foot, o, d)) assemble(reqId, null, foot, d);
          else straightFallback();
        });
      } else {
        straightFallback();
      }
      return;
    }
    var f = fracs[0];
    var p = [o[0] + (d[0] - o[0]) * f, o[1] + (d[1] - o[1]) * f];
    driveTo(o, p).then(function (car) {
      if (reqId !== routeReq) return;
      if (car) finishWithCar(reqId, car, d);
      else carApproach(reqId, o, d, fracs.slice(1));
    });
  }

  // Авто-плечо готово: достраиваем финал до цели пешим профилем или прямой
  function finishWithCar(reqId, car, d) {
    var carEnd = car.coords[car.coords.length - 1];
    if (distM(carEnd, d) < 80) { assemble(reqId, car, null, d); return; }
    brouter(carEnd, d, "foot").then(function (foot) {
      if (reqId !== routeReq) return;
      // Абсурдный пеший крюк (см. footSane) → прямой «неизвестный» отрезок
      if (foot && !footSane(foot, carEnd, d)) foot = null;
      assemble(reqId, car, foot, d);
    });
  }

  // Проверка адекватности пешего плеча: не длиннее прямой более чем в 2 раза (+3 км допуск);
  // горные тропы реально длиннее прямой в 1.3–1.8 раза, но не в несколько раз
  function footSane(foot, a, b) {
    var len = 0;
    for (var i = 1; i < foot.coords.length; i++) len += distM(foot.coords[i - 1], foot.coords[i]);
    var straight = distM(a, b);
    return len <= Math.max(straight * 2, straight + 3000);
  }

  function assemble(reqId, car, foot, dest) {
    if (reqId !== routeReq) return;
    var features = [], stats = {};
    var allCoords = [];
    var footAscent = 0;

    if (car) {
      var L = buildLeg(car.coords, car.messages, classifyDrivePhase, "drive");
      features = features.concat(L.features);
      mergeStats(stats, L.stats);
      allCoords = allCoords.concat(car.coords);
    }
    if (foot) {
      var F = buildLeg(foot.coords, foot.messages, function () { return UNKNOWN_PHASE; }, "foot");
      features = features.concat(F.features);
      mergeStats(stats, F.stats);
      allCoords = allCoords.concat(foot.coords);
      // Набор высоты — для пешей оценки «неизвестного» участка
      footAscent = computeAscent(foot.coords);
      routeState.unknownCoords = foot.coords;
    } else if (car) {
      // Пеший маршрут не построился — дотягиваем прямой пеший остаток до цели
      var carEnd = car.coords[car.coords.length - 1];
      var rem = distM(carEnd, dest);
      if (rem >= 80) {
        features.push({ type: "Feature", properties: { kind: "seg", segType: "foot", phase: UNKNOWN_PHASE }, geometry: { type: "LineString", coordinates: [carEnd, dest] } });
        if (!stats[UNKNOWN_PHASE]) stats[UNKNOWN_PHASE] = { dist: 0 };
        stats[UNKNOWN_PHASE].dist += rem;
        allCoords.push(dest);
        routeState.unknownCoords = [carEnd, dest];
      }
    }

    setRouteFeatures(features);
    // Раскладка: полное время до цели на вахтовке и на вездеходе
    // («неизвестный» участок без дорог в OSM оценивается как внедорожный трек)
    var allPhases = PHASE_ORDER.filter(function (p) { return stats[p]; });
    var totDist = allPhases.reduce(function (a, p) { return a + stats[p].dist; }, 0);
    var unkDist = stats[UNKNOWN_PHASE] ? stats[UNKNOWN_PHASE].dist : 0;
    var breakdown = [];
    routeState.driveTimes = {};
    if (totDist > 0) {
      VEHICLE_ORDER.forEach(function (veh) {
        var t = allPhases.reduce(function (a, p) { return a + vehicleTime(stats[p].dist, p, veh); }, 0);
        // время только по дорогам (без неизвестного участка) — нужно для расчёта спешивания
        routeState.driveTimes[veh] = t - vehicleTime(unkDist, UNKNOWN_PHASE, veh);
        breakdown.push({ phase: veh, dist: totDist, time: t, kind: "drive" });
      });
    }
    if (unkDist > 0) {
      var unkItem = {
        phase: UNKNOWN_PHASE, dist: unkDist, kind: "unknown",
        // два сценария преодоления участка без дорог в OSM
        driveVariant: VEHICLE_ORDER.map(function (veh) {
          return { icon: VEHICLE_ICONS[veh], time: vehicleTime(unkDist, UNKNOWN_PHASE, veh) };
        }),
        footVariant: footTime(unkDist, footAscent),
        note: "нет данных о дороге в OSM — проходимость не гарантирована"
      };
      if (footAscent > 5) unkItem.ascent = footAscent;
      breakdown.push(unkItem);
    }
    var res = { straight: false, breakdown: breakdown, totDist: totDist };
    routeState.lastResult = res;
    renderRoutePanel(null, res);
    if (allCoords.length) fitRoute(allCoords);
  }

  function straightFallback() {
    var o = routeState.origin, d = routeState.dest;
    setRouteFeatures([{ type: "Feature", properties: { kind: "straight" }, geometry: { type: "LineString", coordinates: [o, d] } }]);
    var res = { straight: true, breakdown: [], totDist: distM(o, d), totTime: 0 };
    routeState.lastResult = res;
    renderRoutePanel(null, res);
    fitRoute([o, d]);
  }

  function clearRoute() {
    routeState.dest = null;
    routeState.pickMode = false;
    routeState.lastResult = null;
    routeState.unknownCoords = null;
    routeState.driveTimes = null;
    routeState.lastFeatures = [];
    clearDismount(false);
    if (map.getSource("route")) map.getSource("route").setData(EMPTY_FC);
    map.getCanvas().style.cursor = "";
    routePanel.style.display = "none";
  }

  function renderRoutePanel(statusMsg, result) {
    if (!routePanel) return;
    if (result === undefined) result = routeState.lastResult;
    var html = '<div class="route-head"><b>🧭 Маршрут</b>' +
               '<button type="button" class="route-close" title="Закрыть">✕</button></div>';
    html += '<div class="route-dest">До: <b>' + escapeHtml(routeState.destName || "") + "</b></div>";
    html += '<div class="route-origin">Старт: ' +
            (routeState.origin ? escapeHtml(routeState.originLabel) : "<i>не задан</i>") + "</div>";
    html += '<div class="route-btns">' +
            '<button type="button" data-act="geo">📍 Моё местоположение</button>' +
            '<button type="button" data-act="pick">🖱 Указать на карте</button>' +
            '<button type="button" data-act="pkc">🏙 Петропавловск-Камчатский</button>' +
            "</div>";
    if (statusMsg) html += '<div class="route-status">' + escapeHtml(statusMsg) + "</div>";
    if (result) {
      if (result.straight) {
        html += '<div class="route-result">Расстояние: <b>' + fmtDist(result.totDist) +
                '</b> <span class="route-note">(по прямой — маршрут не найден)</span></div>';
      } else if (result.breakdown && result.breakdown.length) {
        html += '<div class="route-breakdown"><div class="route-bd-title">Время в пути:</div>';
        result.breakdown.forEach(function (b) {
          var icon = VEHICLE_ICONS[b.phase] || "🚗";
          var chip = '<span class="route-chip" style="background:' + (VEHICLE_COLORS[b.phase] || "#8894a3") + '"></span>';
          if (b.kind === "unknown") {
            // Карточка неизвестного участка: дистанция/набор высоты + два сценария
            html += '<div class="route-card">' +
                    '<div class="route-card-head">' + chip +
                    '<span class="route-card-name">' + icon + " " + escapeHtml(b.phase) + "</span>" +
                    '<span class="route-card-dist">' + fmtDist(b.dist) +
                    (b.ascent ? " · ↑" + Math.round(b.ascent) + " м" : "") + "</span></div>";
            (b.driveVariant || []).forEach(function (v, i) {
              html += '<div class="route-kv"><span>' + v.icon + " если проедет " +
                      escapeHtml((VEHICLE_ORDER[i] || "").toLowerCase()) + "</span><b>" + fmtDur(v.time) + "</b></div>";
            });
            if (typeof b.footVariant === "number") {
              html += '<div class="route-kv"><span>🚶 если пешком</span><b>' + fmtDur(b.footVariant) + "</b></div>";
            }
            if (b.note) html += '<div class="route-card-note">' + escapeHtml(b.note) + "</div>";
            html += "</div>";
          } else {
            // Карточка транспорта: название + полное время, ниже — дистанция
            html += '<div class="route-card">' +
                    '<div class="route-card-head">' + chip +
                    '<span class="route-card-name">' + icon + " " + escapeHtml(b.phase) + "</span>" +
                    '<b class="route-card-time">' + fmtDur(b.time) + "</b></div>" +
                    '<div class="route-card-sub">' + fmtDist(b.dist) + " до цели</div></div>";
          }
        });
        html += "</div>";
        // Спешивание на «неизвестном» участке
        if (routeState.unknownCoords) {
          html += '<div class="route-dismount">';
          if (routeState.dismount) {
            var dm = routeState.dismount;
            html += '<div class="route-card route-card-dm">' +
                    '<div class="route-card-head"><span class="route-chip" style="background:#f0883e"></span>' +
                    '<span class="route-card-name">🥾 Спешивание</span>' +
                    '<span class="route-card-dist">' + fmtDist(dm.distTo) + " по участку</span></div>";
            VEHICLE_ORDER.forEach(function (veh) {
              html += '<div class="route-kv"><span>' + VEHICLE_ICONS[veh] + " до точки на " +
                      (veh === "Вахтовка" ? "вахтовке" : "вездеходе") + "</span><b>" + fmtDur(dm.vehTimes[veh]) + "</b></div>";
            });
            html += '<div class="route-kv route-kv-sep"><span>🚶 дальше пешком · ' + fmtDist(dm.distRem) +
                    (dm.ascentRem > 5 ? " ↑" + Math.round(dm.ascentRem) + " м" : "") + "</span><b>" + fmtDur(dm.walkTime) + "</b></div>";
            VEHICLE_ORDER.forEach(function (veh, i) {
              html += '<div class="route-kv' + (i === 0 ? " route-kv-sep" : "") + '"><span>' + VEHICLE_ICONS[veh] +
                      "+🚶 всего до цели</span><b>" + fmtDur(dm.vehTimes[veh] + dm.walkTime) + "</b></div>";
            });
            html += "</div>";
            html += '<button type="button" class="route-dismount-btn" data-act="dismount-clear">✖ Сбросить спешивание</button>';
          } else {
            html += '<button type="button" class="route-dismount-btn" data-act="dismount">🥾 Отметить спешивание</button>';
          }
          html += "</div>";
        }
      }
    }
    html += '<button type="button" class="route-clear">Очистить маршрут</button>';
    routePanel.innerHTML = html;

    routePanel.querySelector(".route-close").onclick = clearRoute;
    routePanel.querySelector(".route-clear").onclick = clearRoute;
    routePanel.querySelectorAll(".route-btns button").forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute("data-act");
        if (act === "geo") { geolocateOrigin(); }
        else if (act === "pkc") { setOrigin(PETROPAVLOVSK.slice(), "Петропавловск-Камчатский"); computeRoute(); }
        else if (act === "pick") {
          routeState.pickMode = true;
          map.getCanvas().style.cursor = "crosshair";
          renderRoutePanel("Кликните на карте, чтобы задать точку старта.");
        }
      };
    });
    routePanel.querySelectorAll(".route-dismount-btn").forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute("data-act");
        if (act === "dismount") {
          routeState.pickDismount = true;
          map.getCanvas().style.cursor = "crosshair";
          renderRoutePanel("Кликните на зелёном пунктирном участке — где вы спешиваетесь (точка привяжется к маршруту).");
        } else if (act === "dismount-clear") {
          clearDismount(true);
        }
      };
    });
  }

  // Кнопка «Проложить маршрут» в попапах (делегирование)
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".pp-route-btn") : null;
    if (!btn) return;
    var lng = parseFloat(btn.getAttribute("data-lng"));
    var lat = parseFloat(btn.getAttribute("data-lat"));
    if (isNaN(lng) || isNaN(lat)) return;
    startRouteTo(lng, lat, btn.getAttribute("data-name"));
  });

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
    setupRouting();
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
