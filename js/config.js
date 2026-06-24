/*
 * Конфигурация портала. Чтобы сделать новый геопортал на этом же движке,
 * достаточно заменить значения здесь и положить свои GeoJSON в папку data/.
 */
window.PORTAL_CONFIG = {
  // Начальный вид карты
  map: {
    center: [55.5, 159.5], // [lat, lng] — Камчатка
    zoom: 6,
    minZoom: 3,
    maxZoom: 18
  },

  // Подложки (базовые слои). Первая с default: true включается по умолчанию.
  basemaps: [
    {
      id: "osm",
      name: "OpenStreetMap",
      default: true,
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenStreetMap contributors"
    },
    {
      id: "topo",
      name: "Рельеф (OpenTopoMap)",
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenTopoMap (CC-BY-SA), &copy; OpenStreetMap",
      maxZoom: 17
    },
    {
      id: "esri-sat",
      name: "Спутник (ESRI)",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
    }
  ],

  // Тематические слои. geojson — путь к файлу в data/.
  // color — цвет маркеров; visible — включён ли слой при загрузке.
  layers: [
    {
      id: "volcanoes",
      name: "Вулканы",
      geojson: "data/volcanoes.geojson",
      color: "#f0883e",
      visible: true
    },
    {
      id: "springs",
      name: "Термальные источники",
      geojson: "data/springs.geojson",
      color: "#58a6ff",
      visible: true
    },
    {
      id: "dostoprim",
      name: "Достопримечательности",
      geojson: "data/dostoprimechatelnosti.geojson",
      color: "#f6c343",
      visible: true,
      // Маркеры-звёзды, яркая раскраска по типу достопримечательности
      marker: {
        shape: "star",
        size: 24,
        colorField: "тип",
        defaultColor: "#ff4081",
        colors: {
          "Геоморфологические": "#ff1744",
          "Гидрологические": "#00b0ff",
          "Гидрогеологические": "#00e5ff",
          "Стратиграфические": "#ffea00",
          "Комплексные": "#d500f9",
          "Палеонтологические": "#76ff03",
          "Историко-геологические": "#ff9100",
          "Минералогические и петрографические": "#1de9b6"
        }
      },
      // Поля попапа для этого слоя (имена отличаются от слоёв по умолчанию)
      popup: {
        titleField: "Name",
        typeField: "тип",
        descriptionField: "подтип",
        photoField: "",
        hideAttributes: true, // скрыть таблицу остальных атрибутов
        photoSlots: 2,        // заготовка под N фотографий
        // Фото по точному имени объекта (путь относительно корня сайта)
        photos: {
          "Халактырский пляж": ["images/halaktyrsky_1.jpg", "images/halaktyrsky_2.jpg"],
          "Кратер вулкана Мутновский": ["images/mutnovsky_1.png", "images/mutnovsky_2.jpg"],
          "Дачные источники": ["images/dachnye_1.jpg", "images/dachnye_2.png"],
          "Кратер вулкана Горелый": ["images/gorely_1.jpg", "images/gorely_2.png"],
          "Острый толбачик": ["images/ostry_tolbachik_1.webp", "images/ostry_tolbachik_2.jpg"],
          "Северный прорыв гора Горшкова": ["images/severny_proryv_1.jpg", "images/severny_proryv_2.webp"],
          "Водопад Спокойный (Вилючинский)": ["images/vodopad_spokoyny_1.png", "images/vodopad_spokoyny_2.jpg"],
          "Скалы Три Брата": ["images/tri_brata_1.png", "images/tri_brata_2.jpg"]
        }
      }
    }
  ],

  // Картографическая основа из OpenStreetMap (через публичный Overpass API).
  // Слои подгружаются по видимой области карты при zoom >= minZoom.
  // geom: "line" | "polygon" | "point" — влияет на стиль отрисовки.
  // query: массив фрагментов Overpass QL (bbox добавляется автоматически).
  // Зеркало Overpass. maps.mail.ru стабильно доступно из РФ; зарубежные зеркала
  // (overpass-api.de и др.) могут быть недоступны. Можно заменить при необходимости.
  overpassEndpoint: "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  osmLayers: [
    {
      id: "osm-water", name: "Вода", geom: "polygon", color: "#4a90d9", minZoom: 10,
      query: ['way["natural"="water"];', 'relation["natural"="water"];', 'way["waterway"="riverbank"];', 'way["waterway"~"river|stream|canal"];']
    },
    {
      id: "osm-vegetation", name: "Растительность", geom: "polygon", color: "#6aa84f", minZoom: 11,
      query: ['way["natural"~"wood|scrub|heath|grassland"];', 'relation["natural"~"wood|scrub"];', 'way["landuse"~"forest|meadow"];']
    },
    {
      id: "osm-landuse", name: "Землепользование", geom: "polygon", color: "#caa472", minZoom: 12,
      query: ['way["landuse"];']
    },
    {
      id: "osm-protected", name: "ООПТ / заповедники", geom: "polygon", color: "#38a169", minZoom: 8,
      query: ['relation["boundary"="protected_area"];', 'way["boundary"="protected_area"];', 'relation["leisure"="nature_reserve"];', 'way["leisure"="nature_reserve"];']
    },
    {
      id: "osm-admin", name: "Административные границы", geom: "polygon", color: "#a05195", minZoom: 7,
      query: ['relation["boundary"="administrative"]["admin_level"~"4|6|8"];']
    },
    {
      id: "osm-highway", name: "Автодороги", geom: "line", color: "#e67e22", minZoom: 11,
      query: ['way["highway"];']
    },
    {
      id: "osm-railway", name: "Железные дороги", geom: "line", color: "#555555", minZoom: 10,
      query: ['way["railway"~"rail|light_rail|subway|tram|narrow_gauge"];']
    },
    {
      id: "osm-power", name: "Линии электропередачи", geom: "line", color: "#c0392b", minZoom: 12,
      query: ['way["power"="line"];', 'way["power"="minor_line"];']
    },
    {
      id: "osm-buildings", name: "Здания", geom: "polygon", color: "#8d6e63", minZoom: 15,
      query: ['way["building"];', 'relation["building"];']
    },
    {
      id: "osm-places", name: "Населённые пункты", geom: "point", color: "#d81b60", minZoom: 6,
      query: ['node["place"~"city|town|village|hamlet"];']
    },
    {
      id: "osm-poi", name: "Точки интереса (POI)", geom: "point", color: "#3949ab", minZoom: 13,
      query: ['node["tourism"];', 'node["amenity"];', 'node["natural"="peak"];']
    }
  ],

  // Какие свойства показывать в попапе и как их подписывать.
  // Поле, заданное в titleField — заголовок; typeField — подпись-бейдж;
  // descriptionField — текст; photoField — ссылка/путь к фото.
  // Все остальные свойства попадут в таблицу атрибутов (кроме служебных ниже).
  popup: {
    titleField: "name",
    typeField: "type",
    descriptionField: "description",
    photoField: "photo",
    // человекочитаемые подписи для таблицы атрибутов
    fieldLabels: {
      height: "Высота, м",
      status: "Статус",
      last_eruption: "Последнее извержение",
      temperature: "Температура, °C",
      source: "Источник"
    }
  }
};
