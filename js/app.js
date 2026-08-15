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
  var BROUTER_PROFILE = { car: "car-fast", foot: "hiking-mountain" };
  var PETROPAVLOVSK = [158.6505, 53.0195];
  var routeState = { origin: null, originLabel: "", dest: null, destName: "", pickMode: false, mode: "car", lastResult: null };
  var routePanel = null;

  // Классификация покрытия и цвета сегментов
  var SURF_COLORS = {
    "Асфальт/твёрдое": "#1a73e8",
    "Гравий/грунтовка": "#e8a13c",
    "Грунт/тропа": "#a0522d",
    "Иное покрытие": "#8e44ad",
    "Покрытие неизвестно": "#8894a3"
  };
  function surfColorExpr() {
    var expr = ["match", ["get", "surface"]];
    Object.keys(SURF_COLORS).forEach(function (k) { expr.push(k, SURF_COLORS[k]); });
    expr.push("#8894a3");
    return expr;
  }
  function surfaceFromTags(tags) {
    tags = tags || "";
    var sm = /surface=([^\s]+)/.exec(tags);
    var s = sm ? sm[1] : "";
    if (/(asphalt|paved|concrete|paving_stones|sett|cobblestone|metal|wood|chipseal)/.test(s)) return "Асфальт/твёрдое";
    if (/(gravel|fine_gravel|compacted|pebblestone)/.test(s)) return "Гравий/грунтовка";
    if (/(ground|dirt|earth|mud|sand|grass|unpaved|soil)/.test(s)) return "Грунт/тропа";
    if (s) return "Иное покрытие";
    var hm = /highway=([^\s]+)/.exec(tags);
    var h = hm ? hm[1] : "";
    if (/(motorway|trunk|primary|secondary|tertiary|residential|living_street|unclassified|service)/.test(h)) return "Асфальт/твёрдое";
    if (/track/.test(h)) return "Гравий/грунтовка";
    if (/(path|footway|bridleway|steps|cycleway|pedestrian)/.test(h)) return "Грунт/тропа";
    return "Покрытие неизвестно";
  }

  function setupRouting() {
    map.addSource("route", { type: "geojson", data: EMPTY_FC });
    // Белая обводка под всеми сегментами
    map.addLayer({
      id: "route-halo", type: "line", source: "route",
      filter: ["==", ["get", "kind"], "seg"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.75 }
    });
    // Авто-сегменты: сплошная линия, цвет по покрытию
    map.addLayer({
      id: "route-seg-car", type: "line", source: "route",
      filter: ["all", ["==", ["get", "kind"], "seg"], ["==", ["get", "mode"], "car"]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": surfColorExpr(), "line-width": 5 }
    });
    // Пешие сегменты: пунктир, цвет по покрытию
    map.addLayer({
      id: "route-seg-foot", type: "line", source: "route",
      filter: ["all", ["==", ["get", "kind"], "seg"], ["==", ["get", "mode"], "foot"]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": surfColorExpr(), "line-width": 4, "line-dasharray": [1.5, 1.2] }
    });
    // Запасная прямая
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
        "circle-color": ["match", ["get", "role"], "origin", "#34a853", "dest", "#e8453c", "#888888"],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 2
      }
    });

    routePanel = document.createElement("div");
    routePanel.className = "route-panel";
    routePanel.style.display = "none";
    document.getElementById("map").appendChild(routePanel);

    map.on("click", function (e) {
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
    if (min < 60) return min + " мин";
    return Math.floor(min / 60) + " ч " + (min % 60) + " мин";
  }
  function distM(a, b) { return turf.distance(turf.point(a), turf.point(b), { units: "kilometers" }) * 1000; }

  // Разбивка геометрии на сегменты по типу покрытия из BRouter messages
  function buildSurfaceSegments(coords, messages, mode) {
    var segs = []; // {end: накопленная длина, cat}
    if (messages && messages.length > 1) {
      var header = messages[0];
      var iTags = header.indexOf("WayTags");
      var iDist = header.indexOf("Distance");
      var cum = 0;
      for (var i = 1; i < messages.length; i++) {
        var dm = parseFloat(messages[i][iDist]) || 0;
        cum += dm;
        segs.push({ end: cum, cat: surfaceFromTags(iTags >= 0 ? messages[i][iTags] : "") });
      }
    }
    var features = [];
    var present = {};
    var geomCum = 0, si = 0, curCat = null, curCoords = null;
    for (var k = 0; k < coords.length - 1; k++) {
      var a = coords[k], b = coords[k + 1];
      var d = distM(a, b);
      var mid = geomCum + d / 2;
      while (segs.length && si < segs.length - 1 && segs[si].end < mid) si++;
      var cat = segs.length ? segs[si].cat : "Покрытие неизвестно";
      present[cat] = true;
      if (cat !== curCat) {
        if (curCoords) features.push({ type: "Feature", properties: { kind: "seg", mode: mode, surface: curCat }, geometry: { type: "LineString", coordinates: curCoords } });
        curCat = cat;
        curCoords = [a];
      }
      curCoords.push(b);
      geomCum += d;
    }
    if (curCoords) features.push({ type: "Feature", properties: { kind: "seg", mode: mode, surface: curCat }, geometry: { type: "LineString", coordinates: curCoords } });
    return { features: features, present: Object.keys(present) };
  }

  function setRouteFeatures(features) {
    map.getSource("route").setData({
      type: "FeatureCollection",
      features: features.concat([
        { type: "Feature", properties: { role: "origin" }, geometry: { type: "Point", coordinates: routeState.origin } },
        { type: "Feature", properties: { role: "dest" }, geometry: { type: "Point", coordinates: routeState.dest } }
      ])
    });
  }

  function fitRoute(coords) {
    var b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    coords.forEach(function (c) { b.extend(c); });
    map.fitBounds(b, { padding: 70, maxZoom: 13, duration: 700 });
  }

  function computeRoute() {
    if (!routeState.origin || !routeState.dest) return;
    var o = routeState.origin, d = routeState.dest;
    var mode = routeState.mode;
    renderRoutePanel("Прокладываю маршрут…");
    var url = BROUTER_URL + "?lonlats=" + o[0] + "," + o[1] + "|" + d[0] + "," + d[1] +
              "&profile=" + BROUTER_PROFILE[mode] + "&alternativeidx=0&format=geojson";
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (gj) {
        var f = gj && gj.features && gj.features[0];
        if (!f || !f.geometry || f.geometry.type !== "LineString" || f.geometry.coordinates.length < 2) {
          throw new Error("no route");
        }
        if (mode !== routeState.mode) return; // профиль сменили пока грузилось
        var coords = f.geometry.coordinates;
        var props = f.properties || {};
        var seg = buildSurfaceSegments(coords, props.messages, mode);
        setRouteFeatures(seg.features);
        var dist = parseFloat(props["track-length"]);
        var dur = parseFloat(props["total-time"]);
        var res = { dist: isNaN(dist) ? null : dist, dur: isNaN(dur) ? null : dur, straight: false, mode: mode, surfaces: seg.present };
        routeState.lastResult = res;
        renderRoutePanel(null, res);
        fitRoute(coords);
      })
      .catch(function () { straightFallback(); });
  }

  function straightFallback() {
    var o = routeState.origin, d = routeState.dest;
    setRouteFeatures([{ type: "Feature", properties: { kind: "straight" }, geometry: { type: "LineString", coordinates: [o, d] } }]);
    var res = { dist: distM(o, d), dur: null, straight: true, mode: routeState.mode, surfaces: [] };
    routeState.lastResult = res;
    renderRoutePanel(null, res);
    fitRoute([o, d]);
  }

  function clearRoute() {
    routeState.dest = null;
    routeState.pickMode = false;
    routeState.lastResult = null;
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
    // Переключатель профиля
    html += '<div class="route-modes">' +
            '<button type="button" data-mode="car" class="' + (routeState.mode === "car" ? "active" : "") + '">🚗 На авто</button>' +
            '<button type="button" data-mode="foot" class="' + (routeState.mode === "foot" ? "active" : "") + '">🚶 Пешком</button>' +
            "</div>";
    html += '<div class="route-btns">' +
            '<button type="button" data-act="geo">📍 Моё местоположение</button>' +
            '<button type="button" data-act="pick">🖱 Указать на карте</button>' +
            '<button type="button" data-act="pkc">🏙 Петропавловск-Камчатский</button>' +
            "</div>";
    if (statusMsg) html += '<div class="route-status">' + escapeHtml(statusMsg) + "</div>";
    if (result) {
      html += '<div class="route-result">Расстояние: <b>' + fmtDist(result.dist) + "</b>";
      if (result.straight) {
        html += ' <span class="route-note">(по прямой — маршрут по дорогам не найден)</span>';
      } else if (result.dur != null) {
        html += " · В пути: <b>" + fmtDur(result.dur) + "</b> <span class=\"route-note\">(" +
                (result.mode === "foot" ? "пешком" : "на авто") + ")</span>";
      }
      html += "</div>";
      if (result.surfaces && result.surfaces.length) {
        html += '<div class="route-legend"><div class="route-legend-title">Покрытие участков:</div>';
        result.surfaces.forEach(function (s) {
          html += '<div class="route-legend-item"><span class="route-chip" style="background:' +
                  (SURF_COLORS[s] || "#8894a3") + '"></span>' + escapeHtml(s) + "</div>";
        });
        html += "</div>";
      }
    }
    html += '<button type="button" class="route-clear">Очистить маршрут</button>';
    routePanel.innerHTML = html;

    routePanel.querySelector(".route-close").onclick = clearRoute;
    routePanel.querySelector(".route-clear").onclick = clearRoute;
    routePanel.querySelectorAll(".route-modes button").forEach(function (b) {
      b.onclick = function () {
        var m = b.getAttribute("data-mode");
        if (m === routeState.mode) return;
        routeState.mode = m;
        if (routeState.origin && routeState.dest) computeRoute();
        else renderRoutePanel();
      };
    });
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
