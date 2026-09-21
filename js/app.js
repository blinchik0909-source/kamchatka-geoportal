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
    unknownCoords: null, driveTimes: null, dismount: null, pickDismount: false, lastFeatures: [],
    // Внедорожный трек: результат, текст ошибки, точка «конца вычисляемого маршрута»
    offroad: null, offroadError: null, cutoffPoint: null,
    // Места ночёвки вдоль маршрута (туристический атрибут): список/ошибка/загрузка
    lodging: null, lodgingError: null, lodgingLoading: false
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

  // ——— Внедорожный трек (отдельная экспериментальная функция) ———
  // A* по сетке рельефа (DEM-тайлы Terrarium) с обходом препятствий OSM
  var OFFROAD_COLOR = "#8e44ad";
  var OFFROAD_MAX_STRAIGHT = 40000; // м: лимит длины по прямой для расчёта
  // Предельный уклон (тангенс): вахтовка ~15°, вездеход ~25°
  var OFFROAD_TAN_LIMIT = {
    "Вахтовка": Math.tan(15 * Math.PI / 180),
    "Вездеход": Math.tan(25 * Math.PI / 180)
  };
  var DEM_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/"; // + z/x/y.png, без ключа

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
    // Внедорожный трек (отдельная функция): фиолетовый пунктир
    map.addLayer({
      id: "route-offroad", type: "line", source: "route",
      filter: ["==", ["get", "kind"], "offroad"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": OFFROAD_COLOR, "line-width": 4, "line-dasharray": [2, 1.5] }
    });
    map.addLayer({
      id: "route-straight", type: "line", source: "route",
      filter: ["==", ["get", "kind"], "straight"],
      paint: { "line-color": "#e8453c", "line-width": 3, "line-dasharray": [2, 2] }
    });
    // Места ночёвки вдоль маршрута (кемпинги/приюты/гостевые дома из OSM)
    map.addSource("route-lodging", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "route-lodging-pt", type: "circle", source: "route-lodging",
      paint: {
        "circle-radius": 7, "circle-color": "#0d9488",
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 2
      }
    });
    map.on("click", "route-lodging-pt", function (e) {
      var p = e.features[0].properties;
      new maplibregl.Popup({ offset: 10 })
        .setLngLat(e.features[0].geometry.coordinates.slice(0, 2))
        .setHTML("<b>" + p.icon + " " + escapeHtml(p.name || p.label) + "</b><br>" + escapeHtml(p.label) +
                 "<br>" + fmtDist(p.along) + " от старта · " + fmtDist(p.off) + " от маршрута")
        .addTo(map);
    });
    map.on("mouseenter", "route-lodging-pt", function () { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "route-lodging-pt", function () { map.getCanvas().style.cursor = ""; });

    map.addLayer({
      id: "route-ends", type: "circle", source: "route",
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": 6,
        "circle-color": ["match", ["get", "role"], "origin", "#34a853", "dest", "#e8453c", "dismount", "#f0883e", "route-end", "#64748b", "#888888"],
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
  //  1) авто прямо до цели; если нет — подбор ближайшей достижимой точки (roadApproach/carApproach);
  //  2) пеший финал проверяется на адекватность (footSane), иначе — маркер конца маршрута.
  function computeRoute() {
    if (!routeState.origin || !routeState.dest) return;
    var reqId = ++routeReq;
    var o = routeState.origin, d = routeState.dest;
    routeState.unknownCoords = null;
    routeState.driveTimes = null;
    routeState.offroad = null;
    routeState.offroadError = null;
    routeState.cutoffPoint = null;
    clearDismount(false);
    clearLodging(false);
    renderRoutePanel("Прокладываю маршрут…");
    driveTo(o, d).then(function (car) {
      if (reqId !== routeReq) return;
      if (car) { finishWithCar(reqId, car, d); return; }
      // Цель не привязалась к дороге у BRouter — ищем ближайшую точку РЕАЛЬНОЙ
      // дороги/просёлка через Overpass, расширяя радиус поиска, и едем туда:
      // даже далёкий просёлок подводит ближе к цели, чем прямая через тайгу
      roadApproach(reqId, o, d, [15000, 40000]);
    }).catch(function () { if (reqId === routeReq) straightFallback(); });
  }

  // Каскад радиусов поиска дороги у цели; резерв — перебор точек на прямой
  function roadApproach(reqId, o, d, radii) {
    if (reqId !== routeReq) return;
    if (!radii.length) { carApproach(reqId, o, d, APPROACH_FRACS); return; }
    nearestRoadPoint(d, radii[0]).then(function (roadPt) {
      if (reqId !== routeReq) return;
      if (!roadPt) { roadApproach(reqId, o, d, radii.slice(1)); return; }
      driveTo(o, roadPt).then(function (car) {
        if (reqId !== routeReq) return;
        if (car) finishWithCar(reqId, car, d);
        else roadApproach(reqId, o, d, radii.slice(1));
      });
    });
  }

  var APPROACH_FRACS = [0.9, 0.7, 0.45];

  // Авто-плечо: сначала авто-профиль; если он отказал (паром, грунтовки — как дорога
  // Козыревск→Ключи) — профиль trekking: идёт по тем же дорогам, но разрешает паромы
  // и любые покрытия. Время всё равно считаем сами по тегам покрытия (VEHICLE_SPEED).
  // Результат ОБЯЗАТЕЛЬНО пропускается через trimDriveLeg: BRouter может увести
  // «машину» на пешую тропу или крутой склон вулкана — обрезаем плечо там.
  function driveTo(a, b) {
    return brouter(a, b, "car").then(function (car) {
      if (car) return trimDriveLeg(car);
      return brouter(a, b, "track").then(trimDriveLeg);
    });
  }

  // Непроезжие для машины типы путей (trekking-фолбэк ходит и по тропам)
  var NON_DRIVABLE_RE = /highway=(path|footway|steps|pedestrian|bridleway|via_ferrata)/;
  var DRIVE_MAX_TAN = 0.25;   // ~14° вдоль пути: круче машина не поднимется/не спустится
  var DRIVE_SLOPE_WIN = 300;  // м: окно оценки устойчивого уклона (не срезать короткие взлобки)

  // Обрезает ТОЛЬКО НЕПРОЕЗЖИЙ ХВОСТ авто-плеча (финальный забор на вулкан
  // по тропе/крутому склону). НЕЛЬЗЯ резать на ПЕРВОМ плохом месте: крутая
  // улица в начале (ПКЦ — город на сопках) обрезала плечо у старта, и пеший
  // финал строился на сотни км (регресс 747 км «пешком» до Ушковского).
  // Алгоритм: помечаем «плохие» точки (тропа в тегах или уклон > DRIVE_MAX_TAN),
  // затем идём С КОНЦА назад и режем только хвостовой плохой участок;
  // останавливаемся, когда набралось ≥400 м непрерывно хорошей дороги.
  // Плохие участки в СЕРЕДИНЕ маршрута не трогаем (дальше есть дорога —
  // значит место проезжаемо, просто крутое/шум высот).
  function trimDriveLeg(leg) {
    if (!leg || !leg.coords || leg.coords.length < 2) return leg;
    var cs = leg.coords;
    var cd = [0];
    for (var k = 1; k < cs.length; k++) cd.push(cd[k - 1] + distM(cs[k - 1], cs[k]));
    var total = cd[cd.length - 1];
    var bad = new Uint8Array(cs.length);

    // 1) непроезжие типы путей из тегов BRouter → пометка точек по дистанции
    if (leg.messages && leg.messages.length > 1) {
      var h = leg.messages[0];
      var iT = h.indexOf("WayTags"), iD = h.indexOf("Distance");
      var cum = 0, kp = 0;
      for (var i = 1; i < leg.messages.length; i++) {
        var d = parseFloat(leg.messages[i][iD]) || 0;
        var isBad = iT >= 0 && NON_DRIVABLE_RE.test(leg.messages[i][iT] || "");
        if (isBad) {
          while (kp < cs.length && cd[kp] < cum - 1) kp++;
          for (var kk = kp; kk < cs.length && cd[kk] <= cum + d + 1; kk++) bad[kk] = 1;
        }
        cum += d;
      }
    }
    // 2) устойчивый уклон вдоль пути (скользящее окно по 3D-координатам)
    var i0 = 0;
    for (var j = 1; j < cs.length; j++) {
      while (cd[j] - cd[i0 + 1] >= DRIVE_SLOPE_WIN && i0 + 1 < j) i0++;
      var span = cd[j] - cd[i0];
      if (span < DRIVE_SLOPE_WIN * 0.6) continue;
      var e0 = cs[i0][2], e1 = cs[j][2];
      if (typeof e0 !== "number" || typeof e1 !== "number") continue;
      if (Math.abs(e1 - e0) / span > DRIVE_MAX_TAN) {
        for (var b2 = i0; b2 <= j; b2++) bad[b2] = 1;
      }
    }

    // Срезаем только хвост: с конца назад до 400 м непрерывно хорошей дороги
    var cutIdx = cs.length - 1;
    var goodRun = 0;
    for (var q = cs.length - 1; q >= 0; q--) {
      if (bad[q]) {
        goodRun = 0;
        cutIdx = q;
      } else {
        if (q < cs.length - 1) goodRun += cd[q + 1] - cd[q];
        if (goodRun >= 400) break;
      }
    }
    if (cutIdx >= cs.length - 1) return leg; // хвост проезжий — ничего не режем
    var cutAt = cd[cutIdx];
    if (cutAt >= total - 50) return leg;
    if (cutAt < 150) return null; // проезжей части фактически нет
    // Режем геометрию по дистанции cutAt
    var outC = [cs[0]];
    for (var m = 1; m < cs.length; m++) {
      if (cd[m] > cutAt) break;
      outC.push(cs[m]);
    }
    if (outC.length < 2) return null;
    // Режем messages той же дистанцией — статистика фаз должна совпадать с геометрией
    var outM = leg.messages;
    if (leg.messages && leg.messages.length > 1) {
      var h2 = leg.messages[0], iD2 = h2.indexOf("Distance");
      outM = [h2];
      var cum2 = 0;
      for (var r = 1; r < leg.messages.length; r++) {
        var d2 = parseFloat(leg.messages[r][iD2]) || 0;
        if (cum2 + d2 >= cutAt) {
          var rest = Math.max(0, cutAt - cum2);
          if (rest > 1) {
            var row = leg.messages[r].slice();
            row[iD2] = String(Math.round(rest));
            outM.push(row);
          }
          break;
        }
        outM.push(leg.messages[r]);
        cum2 += d2;
      }
    }
    return { coords: outC, messages: outM };
  }

  // Запрос к Overpass с перебором зеркал: основной эндпоинт (из config)
  // периодически недоступен — пробуем публичные зеркала по очереди
  var OVERPASS_FALLBACKS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];
  function overpassFetch(query) {
    var urls = [osmEndpoint].concat(OVERPASS_FALLBACKS.filter(function (u) { return u !== osmEndpoint; }));
    var i = 0;
    function tryNext() {
      if (i >= urls.length) return Promise.reject(new Error("overpass unavailable"));
      var u = urls[i++];
      return fetch(u, { method: "POST", body: "data=" + encodeURIComponent(query) })
        .then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.json();
        })
        .catch(function () { return tryNext(); });
    }
    return tryNext();
  }

  // Ближайшая к точке вершина проезжей дороги/просёлка (OSM через Overpass)
  function nearestRoadPoint(pt, radius) {
    var q = "[out:json][timeout:15];way(around:" + (radius || 15000) + "," + pt[1] + "," + pt[0] +
            ')["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|road)$"];out geom;';
    return overpassFetch(q)
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

  // Авто-плечо готово: достраиваем финал до цели пешим профилем.
  // ЗАЩИТА: пеший финал только если до цели ≤30 км по прямой (как и целиком
  // пеший маршрут) — иначе при обрезанном/коротком авто-плече снова
  // появятся пешие маршруты на сотни км (регресс с Ушковским: 747 км пешком).
  function finishWithCar(reqId, car, d) {
    var carEnd = car.coords[car.coords.length - 1];
    var rem = distM(carEnd, d);
    if (rem < 80) { assemble(reqId, car, null, d); return; }
    if (rem > 30000) { assemble(reqId, car, null, d); return; }
    brouter(carEnd, d, "foot").then(function (foot) {
      if (reqId !== routeReq) return;
      // Абсурдный пеший крюк (см. footSane) → маркер «конец вычисляемого маршрута»
      if (foot && !footSane(foot, carEnd, d)) foot = null;
      assemble(reqId, car, foot, d);
    });
  }

  // Проверка адекватности пешего плеча: не длиннее прямой более чем в 3 раза (+3 км допуск).
  // Извилистые пролесные дороги/тропы легитимно длиннее прямой в 2–3 раза; порог ×2
  // отбраковывал хорошие маршруты. От многосоткилометровых петель защищает то, что
  // авто-плечо (driveTo с trekking-фолбэком) теперь довозит максимально близко к цели.
  function footSane(foot, a, b) {
    var len = 0;
    for (var i = 1; i < foot.coords.length; i++) len += distM(foot.coords[i - 1], foot.coords[i]);
    var straight = distM(a, b);
    return len <= Math.max(straight * 3, straight + 3000);
  }

  // ============================================================
  //  ВНЕДОРОЖНЫЙ ТРЕК (отдельная функция, запускается кнопкой)
  //  Строит чёткий маршрут по бездорожью для вахтовки/вездехода:
  //  A* по сетке высот (DEM-тайлы Terrarium, ~40–90 м/ячейка) с учётом
  //  уклона склона и обходом препятствий из OSM (вода, болота, обрывы).
  // ============================================================

  // Запуск: от точки «конца вычисляемого маршрута» до цели
  function runOffroad() {
    var a = routeState.cutoffPoint, d = routeState.dest;
    if (!a || !d) return;
    if (distM(a, d) > OFFROAD_MAX_STRAIGHT) {
      routeState.offroadError = "Слишком далеко для внедорожного расчёта (лимит " + fmtDist(OFFROAD_MAX_STRAIGHT) + " по прямой).";
      renderRoutePanel();
      return;
    }
    var guard = routeReq; // новый маршрут/очистка отменяет расчёт
    routeState.offroadError = null;
    renderRoutePanel("Строю внедорожный трек: рельеф + препятствия OSM (до ~20 сек)…");
    computeOffroadTrack(a, d).then(function (res) {
      if (guard !== routeReq) return;
      if (!res) {
        routeState.offroadError = "Трек не построился: путь перекрыт водой/болотами/крутыми склонами либо рельеф недоступен.";
        renderRoutePanel();
        return;
      }
      routeState.offroad = res;
      setRouteFeatures(routeState.lastFeatures.concat([{
        type: "Feature", properties: { kind: "offroad" },
        geometry: { type: "LineString", coordinates: res.coords }
      }]));
      renderRoutePanel();
      fitRoute(res.coords);
    }).catch(function () {
      if (guard !== routeReq) return;
      routeState.offroadError = "Ошибка при построении внедорожного трека (сеть/данные).";
      renderRoutePanel();
    });
  }

  function clearOffroad() {
    routeState.offroad = null;
    routeState.offroadError = null;
    setRouteFeatures(routeState.lastFeatures.filter(function (f) {
      return !(f.properties && f.properties.kind === "offroad");
    }));
    renderRoutePanel();
  }

  function computeOffroadTrack(a, b) {
    var pad = Math.max(2000, distM(a, b) * 0.3);
    var bbox = padBbox(a, b, pad); // [w, s, e, n]
    return Promise.all([loadDemGrid(bbox), loadObstacles(bbox)]).then(function (rr) {
      var grid = rr[0];
      if (!grid) return null;
      rasterizeObstacles(rr[1], grid);
      var s = gridCellOf(grid, a), g = gridCellOf(grid, b);
      unblockAround(grid, s); // старт/цель могут попасть в «препятствие» (берег и т.п.)
      unblockAround(grid, g);
      // Трек строим по возможностям вездехода (максимально проходимый транспорт)
      var path = astarGrid(grid, s, g, OFFROAD_TAN_LIMIT["Вездеход"]);
      if (!path || path.length < 2) return null;

      // Статистика по «сырому» пути: дистанция, набор, макс. уклон, время по транспорту
      var elev = grid.elev, W = grid.w, cm = grid.cellM;
      var dist = 0, ascent = 0, maxTan = 0;
      var times = {}, blockedVeh = {};
      VEHICLE_ORDER.forEach(function (v) { times[v] = 0; blockedVeh[v] = false; });
      for (var i = 1; i < path.length; i++) {
        var p0 = path[i - 1], p1 = path[i];
        var diag = (p0 % W !== p1 % W) && (((p0 / W) | 0) !== ((p1 / W) | 0));
        var dd = diag ? cm * 1.41421356 : cm;
        var dz = elev[p1] - elev[p0];
        if (dz > 0) ascent += dz;
        var tan = Math.abs(dz) / dd;
        if (tan > maxTan) maxTan = tan;
        dist += dd;
        VEHICLE_ORDER.forEach(function (v) {
          var lim = OFFROAD_TAN_LIMIT[v];
          if (tan > lim) { blockedVeh[v] = true; return; }
          // На уклоне скорость падает: на предельном уклоне остаётся ~35%
          var eff = VEHICLE_SPEED[v][UNKNOWN_PHASE] * (1 - 0.65 * Math.min(tan / lim, 1));
          times[v] += dd / eff;
        });
      }
      VEHICLE_ORDER.forEach(function (v) { if (blockedVeh[v]) times[v] = null; });

      // Геометрия: индексы → lon/lat, упрощение для отрисовки, точные концы
      var coords = path.map(function (idx) { return gridLonLat(grid, idx % W, (idx / W) | 0); });
      coords[0] = a.slice(0, 2);
      coords[coords.length - 1] = b.slice(0, 2);
      if (coords.length > 3) {
        try {
          coords = turf.simplify(turf.lineString(coords), { tolerance: 0.0004, highQuality: true }).geometry.coordinates;
        } catch (e) { /* оставляем как есть */ }
      }
      return { coords: coords, dist: dist, ascent: ascent, maxTan: maxTan, times: times, footTime: footTime(dist, ascent) };
    });
  }

  // ——— Сетка высот из DEM-тайлов Terrarium (AWS, без ключа, CORS открыт) ———
  function lon2tx(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function lat2ty(lat, z) {
    var r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
  }
  function tx2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function ty2lat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
  function padBbox(a, b, padM) {
    var midLat = (a[1] + b[1]) / 2;
    var dLat = padM / 111320;
    var dLon = padM / (111320 * Math.cos(midLat * Math.PI / 180));
    return [Math.min(a[0], b[0]) - dLon, Math.min(a[1], b[1]) - dLat,
            Math.max(a[0], b[0]) + dLon, Math.max(a[1], b[1]) + dLat];
  }
  function loadImg(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = function () { resolve(im); };
      im.onerror = reject;
      im.src = url;
    });
  }
  function loadDemGrid(bbox) {
    var w = bbox[0], s = bbox[1], e = bbox[2], n = bbox[3];
    // Зум подбираем так, чтобы хватило ≤12 тайлов (256×256)
    var z, tx0, tx1, ty0, ty1;
    for (z = 11; z >= 8; z--) {
      tx0 = Math.floor(lon2tx(w, z)); tx1 = Math.floor(lon2tx(e, z));
      ty0 = Math.floor(lat2ty(n, z)); ty1 = Math.floor(lat2ty(s, z));
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 12) break;
    }
    var nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
    var cv = document.createElement("canvas");
    cv.width = nx * 256; cv.height = ny * 256;
    var ctx = cv.getContext("2d");
    var loads = [], fails = 0;
    for (var x = tx0; x <= tx1; x++) {
      for (var y = ty0; y <= ty1; y++) {
        (function (x, y) {
          loads.push(loadImg(DEM_TILE_URL + z + "/" + x + "/" + y + ".png")
            .then(function (im) { ctx.drawImage(im, (x - tx0) * 256, (y - ty0) * 256); })
            .catch(function () { fails++; }));
        })(x, y);
      }
    }
    return Promise.all(loads).then(function () {
      if (fails > loads.length / 2) return null; // рельеф недоступен
      var px0 = lon2tx(w, z) * 256 - tx0 * 256, px1 = lon2tx(e, z) * 256 - tx0 * 256;
      var py0 = lat2ty(n, z) * 256 - ty0 * 256, py1 = lat2ty(s, z) * 256 - ty0 * 256;
      var step = Math.max(1, Math.ceil(Math.max(px1 - px0, py1 - py0) / 400));
      var gw = Math.max(2, Math.floor((px1 - px0) / step));
      var gh = Math.max(2, Math.floor((py1 - py0) / step));
      var img = ctx.getImageData(0, 0, cv.width, cv.height).data;
      var elev = new Float32Array(gw * gh);
      for (var j = 0; j < gh; j++) {
        for (var i = 0; i < gw; i++) {
          var px = Math.min(cv.width - 1, Math.round(px0 + i * step));
          var py = Math.min(cv.height - 1, Math.round(py0 + j * step));
          var o = (py * cv.width + px) * 4;
          // Terrarium: elev = (R*256 + G + B/256) − 32768
          elev[j * gw + i] = img[o] * 256 + img[o + 1] + img[o + 2] / 256 - 32768;
        }
      }
      var midLat = (s + n) / 2;
      var cellM = 40075016.686 * Math.cos(midLat * Math.PI / 180) / (256 * Math.pow(2, z)) * step;
      return { z: z, tx0: tx0, ty0: ty0, px0: px0, py0: py0, step: step,
               w: gw, h: gh, elev: elev, cellM: cellM, blocked: new Uint8Array(gw * gh) };
    });
  }
  function gridCellOf(grid, ll) {
    var gx = Math.round((lon2tx(ll[0], grid.z) * 256 - grid.tx0 * 256 - grid.px0) / grid.step);
    var gy = Math.round((lat2ty(ll[1], grid.z) * 256 - grid.ty0 * 256 - grid.py0) / grid.step);
    return [Math.max(0, Math.min(grid.w - 1, gx)), Math.max(0, Math.min(grid.h - 1, gy))];
  }
  function gridXY(grid, ll) { // дробные координаты ячейки (для растеризации)
    return [(lon2tx(ll[0], grid.z) * 256 - grid.tx0 * 256 - grid.px0) / grid.step,
            (lat2ty(ll[1], grid.z) * 256 - grid.ty0 * 256 - grid.py0) / grid.step];
  }
  function gridLonLat(grid, i, j) {
    return [tx2lon((grid.tx0 * 256 + grid.px0 + i * grid.step) / 256, grid.z),
            ty2lat((grid.ty0 * 256 + grid.py0 + j * grid.step) / 256, grid.z)];
  }
  function unblockAround(grid, cell) {
    for (var dj = -2; dj <= 2; dj++) {
      for (var di = -2; di <= 2; di++) {
        var i = cell[0] + di, j = cell[1] + dj;
        if (i >= 0 && i < grid.w && j >= 0 && j < grid.h) grid.blocked[j * grid.w + i] = 0;
      }
    }
  }

  // ——— Препятствия из OSM: вода/болота (полигоны), обрывы (линии) ———
  function loadObstacles(bbox) {
    var bb = bbox[1] + "," + bbox[0] + "," + bbox[3] + "," + bbox[2];
    var q = '[out:json][timeout:20];(' +
            'way["natural"~"^(water|wetland)$"](' + bb + ');' +
            'relation["natural"~"^(water|wetland)$"](' + bb + ');' +
            'way["natural"="cliff"](' + bb + ');' +
            ');out geom;';
    return overpassFetch(q)
      .then(function (osm) { return osmtogeojson(osm); })
      .catch(function () { return null; }); // без препятствий считаем по одному рельефу
  }
  // Растеризуем препятствия на канве размером с сетку → маска blocked
  function rasterizeObstacles(gj, grid) {
    if (!gj || !gj.features || !gj.features.length) return;
    var cv = document.createElement("canvas");
    cv.width = grid.w; cv.height = grid.h;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#000"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
    function ringPath(ring) {
      for (var i = 0; i < ring.length; i++) {
        var p = gridXY(grid, ring[i]);
        if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
    }
    gj.features.forEach(function (f) {
      var g = f.geometry;
      if (!g) return;
      if (g.type === "Polygon") {
        ctx.beginPath(); g.coordinates.forEach(ringPath); ctx.fill("evenodd");
      } else if (g.type === "MultiPolygon") {
        ctx.beginPath();
        g.coordinates.forEach(function (poly) { poly.forEach(ringPath); });
        ctx.fill("evenodd");
      } else if (g.type === "LineString" || g.type === "MultiLineString") {
        var lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
        ctx.beginPath();
        lines.forEach(function (ln) {
          for (var i = 0; i < ln.length; i++) {
            var p = gridXY(grid, ln[i]);
            if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
          }
        });
        ctx.stroke();
      }
    });
    var d = ctx.getImageData(0, 0, grid.w, grid.h).data;
    for (var k = 0; k < grid.w * grid.h; k++) {
      if (d[k * 4 + 3] > 0) grid.blocked[k] = 1;
    }
  }

  // ——— A* по сетке: стоимость = дистанция × штраф за уклон ———
  function OffHeap() { this.a = []; }
  OffHeap.prototype.push = function (f, i) {
    var a = this.a; a.push([f, i]);
    var c = a.length - 1;
    while (c > 0) {
      var p = (c - 1) >> 1;
      if (a[p][0] <= a[c][0]) break;
      var t = a[p]; a[p] = a[c]; a[c] = t; c = p;
    }
  };
  OffHeap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var c = 0;
      for (;;) {
        var l = c * 2 + 1, r = l + 1, m = c;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === c) break;
        var t = a[m]; a[m] = a[c]; a[c] = t; c = m;
      }
    }
    return top;
  };
  function astarGrid(grid, s, g, maxTan) {
    var W = grid.w, H = grid.h, N = W * H;
    var elev = grid.elev, blocked = grid.blocked, cm = grid.cellM;
    var gScore = new Float64Array(N); gScore.fill(Infinity);
    var came = new Int32Array(N); came.fill(-1);
    var closed = new Uint8Array(N);
    var si = s[1] * W + s[0], gi = g[1] * W + g[0];
    var gx = g[0], gy = g[1];
    function heur(idx) {
      var dx = (idx % W) - gx, dy = ((idx / W) | 0) - gy;
      return Math.sqrt(dx * dx + dy * dy) * cm;
    }
    var heap = new OffHeap();
    gScore[si] = 0;
    heap.push(heur(si), si);
    var DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
    var iter = 0, found = false;
    while (heap.a.length) {
      if (++iter > 600000) return null; // защита от зависания
      var cur = heap.pop()[1];
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === gi) { found = true; break; }
      var cx = cur % W, cy = (cur / W) | 0;
      for (var k = 0; k < 8; k++) {
        var nx2 = cx + DX[k], ny2 = cy + DY[k];
        if (nx2 < 0 || nx2 >= W || ny2 < 0 || ny2 >= H) continue;
        var ni = ny2 * W + nx2;
        if (closed[ni] || blocked[ni]) continue;
        var dd = k < 4 ? cm : cm * 1.41421356;
        var tan = Math.abs(elev[ni] - elev[cur]) / dd;
        if (tan > maxTan) continue; // склон непроходим
        var rel = tan / maxTan;
        var ng = gScore[cur] + dd * (1 + 3 * rel * rel); // крутое — сильно дороже
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          came[ni] = cur;
          heap.push(ng + heur(ni), ni);
        }
      }
    }
    if (!found) return null;
    var path = [gi];
    var c = gi;
    while (came[c] >= 0) { c = came[c]; path.push(c); }
    return path.reverse();
  }

  // ============================================================
  //  НОЧЁВКИ ВДОЛЬ МАРШРУТА (туристический атрибут карты)
  //  Ищет в OSM (Overpass) места, где потенциально можно переночевать,
  //  в коридоре вдоль построенного маршрута; показывает точками на карте
  //  и списком в панели с километражом от старта.
  // ============================================================
  var LODGING_RADIUS = 3000; // м: коридор поиска по обе стороны от трека
  var LODGING_TYPES = {
    camp_site:      ["🏕", "Кемпинг"],
    caravan_site:   ["🚐", "Стоянка автодомов"],
    alpine_hut:     ["🏔", "Горный приют"],
    wilderness_hut: ["🛖", "Изба (приют)"],
    shelter:        ["⛺", "Укрытие"],
    guest_house:    ["🏡", "Гостевой дом"],
    hostel:         ["🛏", "Хостел"],
    hotel:          ["🏨", "Гостиница"],
    motel:          ["🏨", "Мотель"],
    chalet:         ["🏡", "Домики (шале)"]
  };

  // Все линии построенного маршрута (авто + пеший + внедорожный) одним массивом
  function routeLineCoords() {
    var out = [];
    (routeState.lastFeatures || []).forEach(function (f) {
      if (f.geometry && f.geometry.type === "LineString") {
        f.geometry.coordinates.forEach(function (c) { out.push([c[0], c[1]]); });
      }
    });
    return out;
  }

  function runLodging() {
    var line = routeLineCoords();
    if (line.length < 2) return;
    var guard = routeReq; // новый маршрут/очистка отменяет запрос
    routeState.lodgingLoading = true;
    routeState.lodgingError = null;
    renderRoutePanel();
    // Упрощаем линию, чтобы запрос Overpass не разросся (≤ ~60 точек)
    var simp = line;
    try {
      simp = turf.simplify(turf.lineString(line), { tolerance: 0.02, highQuality: false }).geometry.coordinates;
    } catch (e) { /* оставляем как есть */ }
    while (simp.length > 60) {
      simp = simp.filter(function (_, i) { return i % 2 === 0 || i === simp.length - 1; });
    }
    var poly = simp.map(function (c) { return c[1].toFixed(5) + "," + c[0].toFixed(5); }).join(",");
    var around = "(around:" + LODGING_RADIUS + "," + poly + ");";
    var q = "[out:json][timeout:25];(" +
            'nwr["tourism"~"^(camp_site|caravan_site|alpine_hut|wilderness_hut|guest_house|hostel|hotel|motel|chalet)$"]' + around +
            'nwr["amenity"="shelter"]' + around +
            ");out center 80;";
    overpassFetch(q)
      .then(function (osm) {
        if (guard !== routeReq) return;
        routeState.lodgingLoading = false;
        var routeLS = turf.lineString(simp);
        var seen = {};
        var items = [];
        (osm.elements || []).forEach(function (el) {
          var lon = el.lon, lat = el.lat;
          if (lon == null && el.center) { lon = el.center.lon; lat = el.center.lat; }
          if (lon == null) return;
          var tags = el.tags || {};
          var t = tags.tourism || (tags.amenity === "shelter" ? "shelter" : "");
          if (!LODGING_TYPES[t]) return;
          var key = t + "|" + lon.toFixed(4) + "|" + lat.toFixed(4); // дедупликация node/way
          if (seen[key]) return;
          seen[key] = 1;
          var np = turf.nearestPointOnLine(routeLS, turf.point([lon, lat]));
          items.push({
            lon: lon, lat: lat, type: t,
            name: tags["name:ru"] || tags.name || "",
            alongM: (np.properties.location || 0) * 1000, // км от старта вдоль трека
            offM: (np.properties.dist || 0) * 1000        // удаление от трека
          });
        });
        items.sort(function (a, b) { return a.alongM - b.alongM; });
        if (items.length > 40) items = items.slice(0, 40);
        if (items.length) {
          routeState.lodging = items;
          setLodgingFeatures();
        } else {
          routeState.lodging = null;
          routeState.lodgingError = "Вдоль маршрута мест ночёвки в OSM не найдено (коридор " + fmtDist(LODGING_RADIUS) + ").";
        }
        renderRoutePanel();
      })
      .catch(function () {
        if (guard !== routeReq) return;
        routeState.lodgingLoading = false;
        routeState.lodgingError = "Не удалось загрузить места ночёвки (Overpass).";
        renderRoutePanel();
      });
  }

  function setLodgingFeatures() {
    var src = map.getSource("route-lodging");
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: (routeState.lodging || []).map(function (it, i) {
        var tp = LODGING_TYPES[it.type];
        return {
          type: "Feature",
          properties: { idx: i, icon: tp[0], label: tp[1], name: it.name, along: it.alongM, off: it.offM },
          geometry: { type: "Point", coordinates: [it.lon, it.lat] }
        };
      })
    });
  }

  function clearLodging(rerender) {
    routeState.lodging = null;
    routeState.lodgingError = null;
    routeState.lodgingLoading = false;
    var src = map.getSource("route-lodging");
    if (src) src.setData(EMPTY_FC);
    if (rerender) renderRoutePanel();
  }

  function assemble(reqId, car, foot, dest) {
    if (reqId !== routeReq) return;
    var features = [], stats = {};
    var allCoords = [];
    var footAscent = 0;
    var cutoffRem = 0; // остаток до цели, который сайт вычислить не может

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
      // Пеший маршрут не построился, ближе дорог/троп нет — ПРЯМУЮ НЕ рисуем
      // (идти по прямой через тайгу — безумие): ставим маркер
      // «конец вычисляемого маршрута» и честно сообщаем об остатке
      var carEnd = car.coords[car.coords.length - 1];
      var rem = distM(carEnd, dest);
      if (rem >= 80) {
        features.push({ type: "Feature", properties: { role: "route-end" }, geometry: { type: "Point", coordinates: carEnd } });
        cutoffRem = rem;
        routeState.cutoffPoint = carEnd; // старт для внедорожного трека
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
    var res = { straight: false, breakdown: breakdown, totDist: totDist, cutoff: cutoffRem };
    routeState.lastResult = res;
    renderRoutePanel(null, res);
    if (allCoords.length) fitRoute(allCoords.concat([dest]));
  }

  // Ничего не построилось: прямую линию НЕ рисуем — только маркеры и честное сообщение
  function straightFallback() {
    var o = routeState.origin, d = routeState.dest;
    setRouteFeatures([]);
    var res = { straight: true, breakdown: [], totDist: distM(o, d) };
    routeState.lastResult = res;
    renderRoutePanel(null, res);
    fitRoute([o, d]);
  }

  function clearRoute() {
    clearLodging(false);
    routeState.dest = null;
    routeState.pickMode = false;
    routeState.lastResult = null;
    routeState.unknownCoords = null;
    routeState.driveTimes = null;
    routeState.offroad = null;
    routeState.offroadError = null;
    routeState.cutoffPoint = null;
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
        html += '<div class="route-cutoff">⛔ Маршрут вычислить не удалось — дорог и троп до этой точки в OSM нет. ' +
                'До цели по прямой: <b>' + fmtDist(result.totDist) + '</b>.</div>';
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
        if (result.cutoff) {
          if (routeState.offroad) {
            // Карточка построенного внедорожного трека (отдельная функция)
            var off = routeState.offroad;
            html += '<div class="route-card">' +
                    '<div class="route-card-head"><span class="route-chip" style="background:' + OFFROAD_COLOR + '"></span>' +
                    '<span class="route-card-name">🚜 Внедорожный трек</span>' +
                    '<span class="route-card-dist">' + fmtDist(off.dist) +
                    (off.ascent > 5 ? " · ↑" + Math.round(off.ascent) + " м" : "") + "</span></div>";
            html += '<div class="route-kv"><span>макс. уклон на треке</span><b>' +
                    Math.round(Math.atan(off.maxTan) * 180 / Math.PI) + "°</b></div>";
            VEHICLE_ORDER.forEach(function (veh) {
              var t = off.times[veh];
              html += '<div class="route-kv"><span>' + VEHICLE_ICONS[veh] + " " + veh.toLowerCase() + "</span><b>" +
                      (t == null ? "не пройдёт (уклон)" : fmtDur(t)) + "</b></div>";
            });
            html += '<div class="route-kv"><span>🚶 пешком</span><b>' + fmtDur(off.footTime) + "</b></div>";
            html += '<div class="route-card-note">эксперимент: расчёт по рельефу (DEM) с обходом воды, ' +
                    'болот и обрывов из OSM — проходимость не гарантирована</div></div>';
            html += '<button type="button" class="route-offroad-btn" data-act="offroad-clear">✖ Убрать внедорожный трек</button>';
          } else {
            html += '<div class="route-cutoff">⛔ <b>Конец вычисляемого маршрута</b> (серая точка): ' +
                    'дальше дорог и троп в OSM нет. ' +
                    'До цели остаётся ещё <b>' + fmtDist(result.cutoff) + '</b> по прямой.</div>';
            if (routeState.offroadError) {
              html += '<div class="route-card-note">' + escapeHtml(routeState.offroadError) + "</div>";
            }
            html += '<button type="button" class="route-offroad-btn" data-act="offroad">🚜 Проложить внедорожный трек (эксперимент)</button>';
          }
        }
        // Ночёвки вдоль маршрута (туристический атрибут карты)
        if (routeState.lodgingLoading) {
          html += '<div class="route-card-note">Ищу места ночёвки вдоль маршрута…</div>';
        } else if (routeState.lodging) {
          html += '<div class="route-card">' +
                  '<div class="route-card-head"><span class="route-chip" style="background:#0d9488"></span>' +
                  '<span class="route-card-name">🏕 Ночёвки по маршруту</span>' +
                  '<span class="route-card-dist">' + routeState.lodging.length + '</span></div>';
          routeState.lodging.slice(0, 12).forEach(function (it, i) {
            var tp = LODGING_TYPES[it.type];
            html += '<div class="route-kv route-lodging-item" data-idx="' + i + '" title="Показать на карте"><span>' +
                    tp[0] + " " + escapeHtml(it.name || tp[1]) + "</span><b>" + fmtDist(it.alongM) + "</b></div>";
          });
          if (routeState.lodging.length > 12) {
            html += '<div class="route-card-note">и ещё ' + (routeState.lodging.length - 12) + ' — все показаны точками на карте</div>';
          }
          html += '<div class="route-card-note">км — от старта по маршруту; данные OSM — наличие мест не гарантировано</div></div>';
          html += '<button type="button" class="route-lodging-btn" data-act="lodging-clear">✖ Скрыть ночёвки</button>';
        } else {
          if (routeState.lodgingError) {
            html += '<div class="route-card-note">' + escapeHtml(routeState.lodgingError) + "</div>";
          }
          html += '<button type="button" class="route-lodging-btn" data-act="lodging">🏕 Найти ночёвки по маршруту</button>';
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
    routePanel.querySelectorAll(".route-offroad-btn").forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute("data-act");
        if (act === "offroad") runOffroad();
        else if (act === "offroad-clear") clearOffroad();
      };
    });
    routePanel.querySelectorAll(".route-lodging-btn").forEach(function (b) {
      b.onclick = function () {
        if (b.getAttribute("data-act") === "lodging") runLodging();
        else clearLodging(true);
      };
    });
    routePanel.querySelectorAll(".route-lodging-item").forEach(function (el) {
      el.onclick = function () {
        var it = (routeState.lodging || [])[parseInt(el.getAttribute("data-idx"), 10)];
        if (it) map.flyTo({ center: [it.lon, it.lat], zoom: 13 });
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
