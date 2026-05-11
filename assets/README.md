# assets/ — ресурсы для 3D-визуализации

Поместите файлы с указанными именами в эту папку — они подхватятся автоматически.
Если файл отсутствует, используется fallback (однотонный материал или процедурная текстура).

## Структура папки

```
assets/
  environment.hdr            # HDRI окружение (опционально)
  *.jpg                      # PBR-текстуры стен, крыши, цоколя, настила
  bush_*.glb / tree_*.glb    # GLB растительности (опционально)
  bush_*.png / tree_*.png    # PNG-спрайты растительности (fallback)
  houses/                    # см. раздел «Дома и модули» ниже
    house_type_*.json
    modules/<категория>/mod_*.glb
```

## HDRI окружение
| Файл               | Описание                              | Источник           |
|--------------------|---------------------------------------|--------------------|
| environment.hdr    | HDRI карта освещения (рекомендуется 2K–4K) | polyhaven.com |

## Материалы дома
| Файл          | Описание                    | Repeat |
|---------------|-----------------------------|--------|
| wall_diff.jpg | Штукатурка — albedo         | 5×5    |
| wall_norm.jpg | Штукатурка — normal map     | 5×5    |
| wall_roug.jpg | Штукатурка — roughness map  | 5×5    |
| roof_diff.jpg | Черепица — albedo           | 6×6    |
| roof_norm.jpg | Черепица — normal map       | 6×6    |
| roof_roug.jpg | Черепица — roughness map    | 6×6    |
| base_diff.jpg | Цоколь/кирпич — albedo      | 3×1    |
| base_norm.jpg | Цоколь — normal map         | 3×1    |

## Настил (терраса, крыльцо, дорожки)
| Файл          | Описание                    | Repeat |
|---------------|-----------------------------|--------|
| deck_diff.jpg | Доска ДПК — albedo          | 1×1    |
| deck_norm.jpg | Доска ДПК — normal map      | 1×1    |
| deck_roug.jpg | Доска ДПК — roughness map   | 1×1    |

## Земля
Земля использует **процедурные текстуры** (canvas diffuse + normal map).
Внешние файлы ground_diff.jpg / ground_norm.jpg больше не используются.

## 3D-модели растительности (GLB, приоритет)
| Файл          | Описание          | Blender-экспорт                |
|---------------|-------------------|---------------------------------|
| bush_a.glb    | Куст, вариант A   | glTF Binary, Y-up, origin внизу |
| bush_b.glb    | Куст, вариант B   | glTF Binary, Y-up, origin внизу |
| tree_a.glb    | Дерево, вариант A | glTF Binary, Y-up, origin внизу |
| tree_b.glb    | Дерево, вариант B | glTF Binary, Y-up, origin внизу |

**Требования к GLB:**
- Масштаб: 1 unit = 1 метр (реальные пропорции)
- Origin: у основания ствола (Y=0)
- Материалы: Principled BSDF (экспортируется как PBR)
- Полигонаж: до 5–10 тыс. треугольников
- Текстуры: embedded в GLB
- НЕ использовать Draco-сжатие (Three.js r128 не поддерживает без WASM-декодера)

Код автоматически масштабирует модель — важны только пропорции, не абсолютный размер.

## Спрайты растительности (PNG, fallback)
Используются только если GLB-файл отсутствует.

| Файл            | Описание                  | Размер  |
|-----------------|---------------------------|---------|
| bush_a.png      | Куст, вариант A           | 512×512 |
| bush_b.png      | Куст, вариант B           | 512×512 |
| tree_a.png      | Дерево, вариант A         | 512×512 |
| tree_b.png      | Дерево, вариант B         | 512×512 |

Если PNG тоже отсутствуют — используются процедурные canvas-текстуры (самый базовый fallback).

## Дома и модули (`assets/houses/`)

JSON-дескрипторы домов и GLB-модули, из которых дома собираются.

| Подпапка | Содержимое |
|----------|-----------|
| `houses/` | `house_type_*.json` — JSON-дескрипторы домов (формат: `HOUSE_DESCRIPTOR_FORMAT.md` v2). Имена: `house_type_NN.json` (двузначная нумерация). Сейчас 3 канонических примера: `house_type_01.json` (rect + hip), `house_type_02.json` (rect + gable), `house_type_03.json` (Г-образный + flat). Демонстрируются в тестовом приложении `test-house.html`. |
| `houses/modules/walls/`   | `mod_wall_segment.glb`, `mod_pillar.glb` |
| `houses/modules/windows/` | `mod_window_single.glb`, `mod_window_double.glb`, `mod_window_wide.glb`, `mod_window_velux.glb`, `mod_dormer.glb` |
| `houses/modules/doors/`   | `mod_door_single.glb`, `mod_door_onehalf.glb`, `mod_door_double.glb`, `mod_door_slide_single.glb`, `mod_door_slide_double.glb` |
| `houses/modules/base/`    | `mod_base_segment.glb`, `mod_base_pillar.glb` |
| `houses/modules/roof/`    | `mod_roof_gable_slope.glb`, `mod_roof_gable_front.glb`, `mod_roof_hip_slope.glb`, `mod_roof_hip_ridge.glb`, `mod_roof_flat_edge.glb` |
| `houses/modules/decor/`   | `mod_cornice.glb`, `mod_chimney.glb`, `mod_gutter.glb`, `mod_downpipe.glb`, `mod_porch_column.glb`, `mod_porch_step.glb` |
| `houses/modules/site/`    | `mod_fence_panel_wood.glb`, `mod_fence_post.glb`, `mod_bench_a.glb`, `mod_planter_a.glb`, `mod_lamp_a.glb` |

Полный список модулей с дефолтными размерами и соглашениями по дочерним объектам — `HOUSE_MODULES_SPEC.md` (раздел 2).
Исходные `.blend`-файлы хранятся в `/3d_sources/<категория>/` и не отдаются клиенту.

**Требования к экспорту GLB-модулей дома** (отличается от растительности):

- Формат: glTF Binary (.glb), Y-up, `export_yup=True`
- Origin: см. сводную таблицу в спецификации (раздел 4.4)
- Имена дочерних объектов — строго по разделу 4.3 спеки (`frame_left`, `frame_right`, `frame_top`, `frame_bottom`, `glass`, `sill`, `threshold`, `leaf_main`, `leaf_minor`, `handle`, `rail_top`, `rail_bottom`, `flashing` и т.д.)
- Материалы: имена с префиксом `mat_*` (`mat_wall`, `mat_frame`, `mat_glass`, `mat_door`, `mat_metal`, `mat_concrete`, `mat_wood`, `mat_flashing`, …) — код заменяет их при конфигурации
- UV: кубическая проекция по нормали грани
- Полигонаж: до 5 тыс. треугольников на модуль
- Draco-сжатие: НЕ использовать

⚠ В legacy-модулях (single/double/wide окна, distance-двери — собраны до v2) встречаются имена `Glass` (с заглавной) и `treshold` (с опечаткой). Новые модули используют корректные имена по спеке.

## Рекомендованные источники
- HDRI: https://polyhaven.com/hdris (бесплатно, CC0)
- Текстуры: https://polyhaven.com/textures (бесплатно, CC0)
- 3D-модели растений: https://polyhaven.com/models, https://sketchfab.com (CC0/CC-BY)
- Спрайты растений: https://ambientcg.com, https://cgbookcase.com
