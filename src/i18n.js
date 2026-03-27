// Irishka Group Master by SBS — i18n
// Supported languages: es, en, pt, fr, de, it, ru, nl, pl, tr
const I18N = {
  es: {
    tab_compose: "✍️ Mensaje", tab_groups: "👥 Grupos", tab_timer: "⏱️ Timer", tab_license: "🔐 Activar",
    tab_progress: "📊 Estado", tab_history: "📋 Historial",
    label_message: "Mensaje", label_message_sub: "— texto plano, soporta spintax",
    editor_ph: "Escribe tu mensaje aquí...\n\nUsa {opción1|opción2} para spintax.\nLos saltos de línea se respetan exactamente.",
    btn_save_text: "Guardar texto", text_presets_ph: "Textos guardados",
    btn_load_text: "Cargar texto", btn_delete_text: "Eliminar texto",
    preset_name_ph: "Nombre del texto (ej: Venta Base)",
    label_emojis: "Emojis rápidos", label_images: "Imágenes (máx. 5)",
    img_upload_hint: "Clic para agregar imágenes",
    sp_preview_btn: "👁 Vista previa", sp_respin_btn: "🔀 Nuevo spin",
    sp_preview_label: "Vista previa (variación aleatoria)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> escribe <code>{opción1|opción2|opción3}</code> y cada grupo recibirá una variación distinta.<br>Los emojis, saltos de línea y el formato se envían tal cual los escribas.",
    fb_not_detected_title: "Sin conexión",
    fb_not_detected_desc: "Facebook no detectado.",
    btn_open_fb: "Abrir Facebook ahora", fb_connected_sub: "Verificado",
    online_label: "Online", no_connection: "Sin conexión",
    connection_active: "Conexión activa", connection_verified: "Verificado",
    label_scan_groups: "Escanear grupos automáticamente",
    btn_scan: "Cargar grupos de Facebook",
    btn_verify_groups: "✅ Comprobar grupos que permiten publicar",
    btn_leave_unpostable: "🚪 Salir de grupos sin permiso",
    btn_check_moderation: "📊 Comprobar pendientes/aprobados/rechazados/eliminados",
    moderation_mode_label: "Modo de chequeo", moderation_mode_fast: "Rápido", moderation_mode_deep: "Profundo",
    btn_delete_pending: "🧹 Eliminar posts pendientes/rechazados/eliminados",
    label_groups_count: "Grupos", btn_select_all: "Todos", btn_deselect_all: "Ninguno",
    group_set_name_ph: "Nombre de lista (ej: Venta Autos)", btn_save_group_set: "Salvar lista",
    group_sets_ph: "Seleccionar lista guardada", btn_load_group_set: "Cargar lista",
    btn_delete_group_set: "Eliminar lista", btn_add_group: "+ Agregar",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Sin grupos todavía.<br>Usa el escáner o agrega manualmente abajo.",
    timer_between_posts: "⏱️ Timer entre posts", label_time_unit: "Unidad de tiempo",
    btn_unit_sec: "Segundos", btn_unit_min: "Minutos",
    label_wait_between: "Espera entre grupos", label_random_var: "Variación aleatoria (±)",
    variation_hint: "Variación para parecer más humano y evitar bloqueos.",
    daily_limit_toggle: "🗓️ Límite diario",
    label_daily_posts: "Posts exitosos por día", label_resume_time: "Reanudar a las (24h)",
    daily_limit_hint: "Al llegar al límite, se pausa y reanuda a la hora configurada.",
    silent_mode: "🕶️ Modo silencioso (pestañas en segundo plano)",
    close_tab_after: "🧹 Cerrar pestaña al terminar cada grupo",
    verified_only: "Publicar solo en grupos verificados",
    verified_only_hint: "Si activas esto, se saltarán grupos con \"Sin permiso para publicar\" o \"Sin verificar\".",
    label_range: "Rango estimado", lbl_min: "MIN", lbl_max: "MAX",
    notify_end: "🔔 Notificar al terminar",
    prog_not_started: "Sin iniciar", prog_empty: "Inicia el proceso para ver el estado.", in_progress: "En proceso...",
    next_post_in: "Próximo post en", seconds: "segundos", wait_next_post: "Siguiente post en {sec}s", posting_group_of: "Publicando grupo {current} de {total}...", all_published: "Todo publicado!",
    log_session: "🔍 Log de sesión", btn_copy_log: "📋 Copiar log",
    history_title: "Últimos 5 mensajes guardados", btn_clear_history: "🗑 Borrar historial",
    history_empty: "No hay mensajes guardados aún.<br>Cada vez que inicies posts, el texto se guarda aquí.",
    license_title: "Activar licencia",
    license_sub: "Pega tu clave de licencia para desbloquear funciones Pro.",
    license_key_label: "Clave de licencia",
    license_key_ph: "XXXX-XXXX-XXXX-XXXX",
    license_endpoint_label: "Endpoint de validación (avanzado)",
    license_endpoint_ph: "https://tu-dominio.com/api/license/validate",
    btn_save_license: "Guardar clave",
    btn_validate_license: "Validar",
    btn_save_endpoint: "Guardar endpoint",
    license_enter_key: "Por favor pega una clave de licencia.",
    license_endpoint_required: "Por favor pega el endpoint de validación.",
    license_endpoint_invalid: "Endpoint inválido. Usa una URL http(s) válida.",
    license_endpoint_saved: "Endpoint guardado: {endpoint}",
    license_status_empty: "Estado de licencia: No activada.",
    license_status_saved: "Clave guardada: {key}",
    license_validating: "Validando licencia...",
    license_no_endpoint: "Validación online no configurada todavía.",
    license_invalid_reason_default: "Clave inválida",
    license_status_valid: "Licencia activa ({plan}). Verificada: {checkedAt}",
    license_status_invalid: "Licencia inválida: {reason}. Verificada: {checkedAt}",
    premium_locked_msg: "Esta función es Pro. Activa tu licencia para continuar.",
    premium_locked_tooltip: "Función Pro (requiere licencia activa)",
    free_daily_limit_forced: "Plan gratis: máximo 3 posteos exitosos por día. Activa Pro para posteos ilimitados.",
    plan_badge_free: "Plan Free: máximo 3 posteos exitosos por día",
    plan_badge_pro: "Plan Pro: posteos ilimitados",
    btn_go_pro_unlimited: "Go Pro (Unlimited)",
    pro_active_label: "Pro active",
    group_badge_can_post: "Se puede publicar", group_badge_no_permission: "Sin permiso para publicar", group_badge_unverified: "Sin verificar",
    post_status_ok: "OK", post_status_err: "Error", post_status_pending: "Pendiente",
    mod_pending: "Pendiente", mod_approved: "Aprobado", mod_rejected: "Rechazado", mod_deleted: "Eliminado",
    group_btn_open: "Ir al grupo", group_btn_remove_title: "Eliminar",
    log_groups_need_first: "Primero agrega o escanea grupos.",
    log_verify_start: "Comprobando si se puede publicar...",
    log_verify_item: "Verificando {current}/{total}: {name}",
    log_verify_done: "Verificación completa: {ok} pueden publicar, {noperm} sin permiso.",
    log_verify_error: "Error al verificar grupos:",
    log_moderation_start: "Comprobando estados de posts en todos los grupos...",
    log_moderation_item: "Comprobando {current}/{total}: {name}",
    log_moderation_done: "Comprobación de estados completada: {ok} pueden publicar, {noperm} sin permiso.",
    log_moderation_error: "Error al comprobar estados:",
    log_leave_none: "No hay grupos marcados sin permiso para salir.",
    log_leave_confirm: "Se intentará salir de {total} grupos. ¿Continuar?",
    log_leave_item: "Saliendo {current}/{total}: {name}",
    log_leave_done: "Salir de grupos completado: {ok} ok, {fail} sin cambios.",
    log_leave_error: "Error saliendo de grupos:",
    log_clean_select_groups: "Selecciona grupos para limpiar primero.",
    log_clean_nothing_selected: "No hay posts pendientes/rechazados/eliminados en los grupos seleccionados.",
    log_clean_confirm: "Se eliminarán posts pendientes/rechazados/eliminados en {total} grupos seleccionados. ¿Continuar?",
    log_clean_group: "Limpiando {current}/{total}: {name}",
    log_clean_done: "Eliminación completada: {total} posts.",
    log_clean_error: "Error eliminando posts:",
    unknown: "desconocido",
    btn_reset: "🗑️ Reset", btn_start: "🚀 Iniciar posts", btn_stop: "⏹ Detener", btn_upgrade: "Upgrade to Pro",
    verifying: "Verificando...", publishing: "Publicando...",
  },
  en: {
    tab_compose: "✍️ Message", tab_groups: "👥 Groups", tab_timer: "⏱️ Timer", tab_license: "🔐 Activate",
    tab_progress: "📊 Status", tab_history: "📋 History",
    label_message: "Message", label_message_sub: "— plain text, supports spintax",
    editor_ph: "Write your message here...\n\nUse {option1|option2} for spintax.\nLine breaks are respected exactly.",
    btn_save_text: "Save text", text_presets_ph: "Select saved text",
    btn_load_text: "Load text", btn_delete_text: "Delete text",
    preset_name_ph: "Text name (e.g. Base Sale)",
    label_emojis: "Quick emojis", label_images: "Images (max. 5)",
    img_upload_hint: "Click to add images",
    sp_preview_btn: "👁 Preview", sp_respin_btn: "🔀 New spin",
    sp_preview_label: "Preview (random variation)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> write <code>{option1|option2|option3}</code> and each group gets a different variation.<br>Emojis, line breaks and formatting are sent exactly as written.",
    fb_not_detected_title: "No connection",
    fb_not_detected_desc: "Facebook not detected.",
    btn_open_fb: "Open Facebook now", fb_connected_sub: "Verified",
    online_label: "Online", no_connection: "No connection",
    connection_active: "Active connection", connection_verified: "Verified",
    label_scan_groups: "Scan groups automatically",
    btn_scan: "Load groups from Facebook",
    btn_verify_groups: "✅ Check groups that allow posting",
    btn_leave_unpostable: "🚪 Leave groups without post permission",
    btn_check_moderation: "📊 Check pending/approved/rejected/deleted",
    moderation_mode_label: "Check mode", moderation_mode_fast: "Fast", moderation_mode_deep: "Deep",
    btn_delete_pending: "🧹 Delete pending/rejected/deleted posts",
    label_groups_count: "Groups", btn_select_all: "All", btn_deselect_all: "None",
    group_set_name_ph: "List name (e.g. Car Sales)", btn_save_group_set: "Save list",
    group_sets_ph: "Select saved list", btn_load_group_set: "Load list",
    btn_delete_group_set: "Delete list", btn_add_group: "+ Add",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "No groups yet.<br>Use the scanner or add manually below.",
    timer_between_posts: "⏱️ Timer between posts", label_time_unit: "Time unit",
    btn_unit_sec: "Seconds", btn_unit_min: "Minutes",
    label_wait_between: "Wait between groups", label_random_var: "Random variation (±)",
    variation_hint: "Variation to appear more human and avoid blocks.",
    daily_limit_toggle: "🗓️ Daily limit",
    label_daily_posts: "Successful posts per day", label_resume_time: "Resume next day at (24hs):",
    daily_limit_hint: "When the limit is reached, it pauses and resumes at your configured time.",
    silent_mode: "🕶️ Silent mode (tabs in background)",
    close_tab_after: "🧹 Close tab after each group",
    verified_only: "Post only in verified groups",
    verified_only_hint: "If enabled, groups without posting permission or unverified will be skipped.",
    label_range: "Estimated range", lbl_min: "MIN", lbl_max: "MAX",
    notify_end: "🔔 Notify when finished",
    prog_not_started: "Not started", prog_empty: "Start the process to see status.", in_progress: "In progress...",
    next_post_in: "Next post in", seconds: "seconds", wait_next_post: "Next post in {sec}s", posting_group_of: "Posting group {current} of {total}...", all_published: "All posts published!",
    log_session: "🔍 Session log", btn_copy_log: "📋 Copy log",
    history_title: "Last 5 saved messages", btn_clear_history: "🗑 Clear history",
    history_empty: "No messages saved yet.<br>Every time you start posting, the text is saved here.",
    license_title: "Activate license",
    license_sub: "Paste your license key to unlock Pro features.",
    license_key_label: "License key",
    license_key_ph: "XXXX-XXXX-XXXX-XXXX",
    license_endpoint_label: "Validation endpoint (advanced)",
    license_endpoint_ph: "https://your-domain.com/api/license/validate",
    btn_save_license: "Save key",
    btn_validate_license: "Validate",
    btn_save_endpoint: "Save endpoint",
    license_enter_key: "Please paste a license key.",
    license_endpoint_required: "Please paste the validation endpoint.",
    license_endpoint_invalid: "Invalid endpoint. Use a valid http(s) URL.",
    license_endpoint_saved: "Saved endpoint: {endpoint}",
    license_status_empty: "License status: Not activated.",
    license_status_saved: "Saved key: {key}",
    license_validating: "Validating license...",
    license_no_endpoint: "Online validation is not configured yet.",
    license_invalid_reason_default: "Invalid key",
    license_status_valid: "License active ({plan}). Checked: {checkedAt}",
    license_status_invalid: "License invalid: {reason}. Checked: {checkedAt}",
    premium_locked_msg: "This feature is Pro. Activate your license to continue.",
    premium_locked_tooltip: "Pro feature (active license required)",
    free_daily_limit_forced: "Free plan: maximum 3 successful posts per day. Activate Pro for unlimited posting.",
    plan_badge_free: "Free plan: maximum 3 successful posts per day",
    plan_badge_pro: "Pro plan: unlimited posting",
    btn_go_pro_unlimited: "Go Pro (Unlimited)",
    pro_active_label: "Pro active",
    group_badge_can_post: "Can post", group_badge_no_permission: "No posting permission", group_badge_unverified: "Not verified",
    post_status_ok: "OK", post_status_err: "Error", post_status_pending: "Pending",
    mod_pending: "Pending", mod_approved: "Approved", mod_rejected: "Rejected", mod_deleted: "Deleted",
    group_btn_open: "Open group", group_btn_remove_title: "Remove",
    log_groups_need_first: "Add or scan groups first.",
    log_verify_start: "Checking posting permission...",
    log_verify_item: "Checking {current}/{total}: {name}",
    log_verify_done: "Verification complete: {ok} can post, {noperm} no permission.",
    log_verify_error: "Error verifying groups:",
    log_moderation_start: "Checking post status in all groups...",
    log_moderation_item: "Checking {current}/{total}: {name}",
    log_moderation_done: "Status check complete: {ok} can post, {noperm} no permission.",
    log_moderation_error: "Error checking status:",
    log_leave_none: "No groups marked without permission to leave.",
    log_leave_confirm: "Will attempt to leave {total} groups. Continue?",
    log_leave_item: "Leaving {current}/{total}: {name}",
    log_leave_done: "Leave groups completed: {ok} ok, {fail} unchanged.",
    log_leave_error: "Error leaving groups:",
    log_clean_select_groups: "Select groups to clean first.",
    log_clean_nothing_selected: "No pending/rejected/deleted posts in selected groups.",
    log_clean_confirm: "Pending/rejected/deleted posts will be removed in {total} selected groups. Continue?",
    log_clean_group: "Cleaning {current}/{total}: {name}",
    log_clean_done: "Cleanup completed: {total} posts.",
    log_clean_error: "Error deleting posts:",
    unknown: "unknown",
    btn_reset: "🗑️ Reset", btn_start: "🚀 Start posting", btn_stop: "⏹ Stop", btn_upgrade: "Upgrade to Pro",
    verifying: "Verifying...", publishing: "Publishing...",
  },
  pt: {
    tab_compose: "✍️ Mensagem", tab_groups: "👥 Grupos", tab_timer: "⏱️ Timer",
    tab_progress: "📊 Status", tab_history: "📋 Histórico",
    label_message: "Mensagem", label_message_sub: "— texto simples, suporta spintax",
    editor_ph: "Escreva sua mensagem aqui...\n\nUse {opção1|opção2} para spintax.\nAs quebras de linha são respeitadas.",
    btn_save_text: "Salvar texto", text_presets_ph: "Textos salvos",
    btn_load_text: "Carregar texto", btn_delete_text: "Excluir texto",
    preset_name_ph: "Nome do texto (ex: Venda Base)",
    label_emojis: "Emojis rápidos", label_images: "Imagens (máx. 5)",
    img_upload_hint: "Clique para adicionar imagens",
    sp_preview_btn: "👁 Prévia", sp_respin_btn: "🔀 Novo spin",
    sp_preview_label: "Prévia (variação aleatória)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> escreva <code>{opção1|opção2|opção3}</code> e cada grupo receberá uma variação diferente.<br>Emojis, quebras de linha e formatação são enviados exatamente como escritos.",
    fb_not_detected_title: "Facebook não detectado",
    fb_not_detected_desc: "Para escanear seus grupos você precisa ter o Facebook aberto no Chrome e estar logado.",
    btn_open_fb: "Abrir Facebook agora", fb_connected_sub: "✅ Conectado ao Facebook",
    label_scan_groups: "Escanear grupos automaticamente",
    btn_scan: "Carregar grupos do Facebook",
    btn_verify_groups: "✅ Verificar toda a lista",
    btn_leave_unpostable: "🚪 Sair de grupos sem permissão",
    btn_check_moderation: "📊 Verificar pendentes/aprovados/rejeitados/excluídos",
    btn_delete_pending: "🧹 Excluir posts pendentes/rejeitados/excluídos",
    label_groups_count: "Grupos", btn_select_all: "Todos", btn_deselect_all: "Nenhum",
    group_set_name_ph: "Nome da lista (ex: Venda de Carros)", btn_save_group_set: "Salvar lista",
    group_sets_ph: "Listas salvas", btn_load_group_set: "Carregar lista",
    btn_delete_group_set: "Excluir lista", btn_add_group: "+ Adicionar",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Sem grupos ainda.<br>Use o scanner ou adicione manualmente abaixo.",
    timer_between_posts: "⏱️ Timer entre posts", label_time_unit: "Unidade de tempo",
    btn_unit_sec: "Segundos", btn_unit_min: "Minutos",
    label_wait_between: "Espera entre grupos", label_random_var: "Variação aleatória (±)",
    variation_hint: "Variação para parecer mais humano e evitar bloqueios.",
    daily_limit_toggle: "🗓️ Limite diário (pausar e retomar amanhã 09:00)",
    label_daily_posts: "Posts bem-sucedidos por dia",
    daily_limit_hint: "Ao atingir o limite, pausa automaticamente e retoma amanhã às 09:00.",
    silent_mode: "🕶️ Modo silencioso (abas em segundo plano)",
    close_tab_after: "🧹 Fechar aba após cada grupo",
    verified_only: "Postar apenas em grupos verificados",
    verified_only_hint: "Se ativado, grupos sem permissão ou não verificados serão ignorados.",
    label_range: "Faixa estimada", lbl_min: "min mínimo", lbl_max: "min máximo",
    notify_end: "🔔 Notificar ao terminar",
    prog_not_started: "Não iniciado", prog_empty: "Inicie o processo para ver o status.",
    next_post_in: "Próximo post em", seconds: "segundos",
    log_session: "🔍 Log de sessão", btn_copy_log: "📋 Copiar log",
    history_title: "Últimas 5 mensagens salvas", btn_clear_history: "🗑 Limpar histórico",
    history_empty: "Ainda não há mensagens salvas.<br>Cada vez que iniciar posts, o texto é salvo aqui.",
    btn_reset: "🗑️ Reset", btn_start: "🚀 Iniciar posts", btn_stop: "⏹ Parar",
    verifying: "Verificando...", publishing: "Publicando...",
  },
  fr: {
    tab_compose: "✍️ Message", tab_groups: "👥 Groupes", tab_timer: "⏱️ Minuterie",
    tab_progress: "📊 Statut", tab_history: "📋 Historique",
    label_message: "Message", label_message_sub: "— texte brut, supporte le spintax",
    editor_ph: "Écrivez votre message ici...\n\nUtilisez {option1|option2} pour le spintax.\nLes sauts de ligne sont respectés.",
    btn_save_text: "Sauvegarder le texte", text_presets_ph: "Textes sauvegardés",
    btn_load_text: "Charger le texte", btn_delete_text: "Supprimer le texte",
    preset_name_ph: "Nom du texte (ex: Vente de base)",
    label_emojis: "Emojis rapides", label_images: "Images (max. 5)",
    img_upload_hint: "Cliquez pour ajouter des images",
    sp_preview_btn: "👁 Aperçu", sp_respin_btn: "🔀 Nouveau spin",
    sp_preview_label: "Aperçu (variation aléatoire)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> écrivez <code>{option1|option2|option3}</code> et chaque groupe recevra une variation différente.<br>Les emojis, sauts de ligne et la mise en forme sont envoyés tels quels.",
    fb_not_detected_title: "Facebook non détecté",
    fb_not_detected_desc: "Pour scanner vos groupes, vous devez avoir Facebook ouvert dans Chrome et être connecté.",
    btn_open_fb: "Ouvrir Facebook maintenant", fb_connected_sub: "✅ Connecté à Facebook",
    label_scan_groups: "Scanner les groupes automatiquement",
    btn_scan: "Charger les groupes de Facebook",
    btn_verify_groups: "✅ Vérifier toute la liste",
    btn_leave_unpostable: "🚪 Quitter les groupes sans permission",
    btn_check_moderation: "📊 Vérifier en attente/approuvé/rejeté/supprimé",
    btn_delete_pending: "🧹 Supprimer les posts en attente/rejetés/supprimés",
    label_groups_count: "Groupes", btn_select_all: "Tous", btn_deselect_all: "Aucun",
    group_set_name_ph: "Nom de la liste (ex: Vente de voitures)", btn_save_group_set: "Sauvegarder la liste",
    group_sets_ph: "Listes sauvegardées", btn_load_group_set: "Charger la liste",
    btn_delete_group_set: "Supprimer la liste", btn_add_group: "+ Ajouter",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Pas encore de groupes.<br>Utilisez le scanner ou ajoutez manuellement ci-dessous.",
    timer_between_posts: "⏱️ Minuterie entre les posts", label_time_unit: "Unité de temps",
    btn_unit_sec: "Secondes", btn_unit_min: "Minutes",
    label_wait_between: "Attente entre les groupes", label_random_var: "Variation aléatoire (±)",
    variation_hint: "Variation pour paraître plus humain et éviter les blocages.",
    daily_limit_toggle: "🗓️ Limite quotidienne (pause et reprise demain 09:00)",
    label_daily_posts: "Posts réussis par jour",
    daily_limit_hint: "Lorsque la limite est atteinte, pause automatique et reprise demain à 09:00.",
    silent_mode: "🕶️ Mode silencieux (onglets en arrière-plan)",
    close_tab_after: "🧹 Fermer l'onglet après chaque groupe",
    verified_only: "Publier uniquement dans les groupes vérifiés",
    verified_only_hint: "Si activé, les groupes sans permission ou non vérifiés seront ignorés.",
    label_range: "Plage estimée", lbl_min: "min minimum", lbl_max: "min maximum",
    notify_end: "🔔 Notifier à la fin",
    prog_not_started: "Non démarré", prog_empty: "Démarrez le processus pour voir le statut.",
    next_post_in: "Prochain post dans", seconds: "secondes",
    log_session: "🔍 Journal de session", btn_copy_log: "📋 Copier le journal",
    history_title: "Les 5 derniers messages sauvegardés", btn_clear_history: "🗑 Effacer l'historique",
    history_empty: "Aucun message sauvegardé pour l'instant.<br>Chaque fois que vous démarrez des posts, le texte est sauvegardé ici.",
    btn_reset: "🗑️ Réinitialiser", btn_start: "🚀 Démarrer les posts", btn_stop: "⏹ Arrêter",
    verifying: "Vérification...", publishing: "Publication...",
  },
  de: {
    tab_compose: "✍️ Nachricht", tab_groups: "👥 Gruppen", tab_timer: "⏱️ Timer",
    tab_progress: "📊 Status", tab_history: "📋 Verlauf",
    label_message: "Nachricht", label_message_sub: "— Klartext, unterstützt Spintax",
    editor_ph: "Schreibe deine Nachricht hier...\n\nVerwende {Option1|Option2} für Spintax.\nZeilenumbrüche werden genau respektiert.",
    btn_save_text: "Text speichern", text_presets_ph: "Gespeicherte Texte",
    btn_load_text: "Text laden", btn_delete_text: "Text löschen",
    preset_name_ph: "Textname (z.B. Basis-Verkauf)",
    label_emojis: "Schnell-Emojis", label_images: "Bilder (max. 5)",
    img_upload_hint: "Klicken um Bilder hinzuzufügen",
    sp_preview_btn: "👁 Vorschau", sp_respin_btn: "🔀 Neuer Spin",
    sp_preview_label: "Vorschau (zufällige Variation)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> schreibe <code>{Option1|Option2|Option3}</code> und jede Gruppe erhält eine andere Variation.<br>Emojis, Zeilenumbrüche und Formatierung werden genau so gesendet.",
    fb_not_detected_title: "Facebook nicht erkannt",
    fb_not_detected_desc: "Um deine Gruppen zu scannen, muss Facebook in Chrome geöffnet und angemeldet sein.",
    btn_open_fb: "Facebook jetzt öffnen", fb_connected_sub: "✅ Mit Facebook verbunden",
    label_scan_groups: "Gruppen automatisch scannen",
    btn_scan: "Gruppen von Facebook laden",
    btn_verify_groups: "✅ Gesamte Liste prüfen",
    btn_leave_unpostable: "🚪 Gruppen ohne Erlaubnis verlassen",
    btn_check_moderation: "📊 Ausstehend/Genehmigt/Abgelehnt/Gelöscht prüfen",
    btn_delete_pending: "🧹 Ausstehende/Abgelehnte/Gelöschte Posts löschen",
    label_groups_count: "Gruppen", btn_select_all: "Alle", btn_deselect_all: "Keine",
    group_set_name_ph: "Listenname (z.B. Autoverkauf)", btn_save_group_set: "Liste speichern",
    group_sets_ph: "Gespeicherte Listen", btn_load_group_set: "Liste laden",
    btn_delete_group_set: "Liste löschen", btn_add_group: "+ Hinzufügen",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Noch keine Gruppen.<br>Verwende den Scanner oder füge manuell unten hinzu.",
    timer_between_posts: "⏱️ Timer zwischen Posts", label_time_unit: "Zeiteinheit",
    btn_unit_sec: "Sekunden", btn_unit_min: "Minuten",
    label_wait_between: "Wartezeit zwischen Gruppen", label_random_var: "Zufällige Variation (±)",
    variation_hint: "Variation um menschlicher zu wirken und Sperren zu vermeiden.",
    daily_limit_toggle: "🗓️ Tageslimit (pausieren und morgen 09:00 fortfahren)",
    label_daily_posts: "Erfolgreiche Posts pro Tag",
    daily_limit_hint: "Beim Erreichen des Limits wird automatisch pausiert und morgen um 09:00 fortgefahren.",
    silent_mode: "🕶️ Stiller Modus (Tabs im Hintergrund)",
    close_tab_after: "🧹 Tab nach jeder Gruppe schließen",
    verified_only: "Nur in verifizierten Gruppen posten",
    verified_only_hint: "Wenn aktiviert, werden Gruppen ohne Erlaubnis oder nicht verifizierte übersprungen.",
    label_range: "Geschätzte Spanne", lbl_min: "min Minimum", lbl_max: "min Maximum",
    notify_end: "🔔 Benachrichtigen wenn fertig",
    prog_not_started: "Nicht gestartet", prog_empty: "Starte den Prozess um den Status zu sehen.",
    next_post_in: "Nächster Post in", seconds: "Sekunden",
    log_session: "🔍 Sitzungsprotokoll", btn_copy_log: "📋 Protokoll kopieren",
    history_title: "Letzte 5 gespeicherte Nachrichten", btn_clear_history: "🗑 Verlauf löschen",
    history_empty: "Noch keine gespeicherten Nachrichten.<br>Jedes Mal wenn Posts gestartet werden, wird der Text hier gespeichert.",
    btn_reset: "🗑️ Zurücksetzen", btn_start: "🚀 Posts starten", btn_stop: "⏹ Stoppen",
    verifying: "Verifizierung...", publishing: "Veröffentlichung...",
  },
  it: {
    tab_compose: "✍️ Messaggio", tab_groups: "👥 Gruppi", tab_timer: "⏱️ Timer",
    tab_progress: "📊 Stato", tab_history: "📋 Cronologia",
    label_message: "Messaggio", label_message_sub: "— testo semplice, supporta spintax",
    editor_ph: "Scrivi il tuo messaggio qui...\n\nUsa {opzione1|opzione2} per spintax.\nI ritorni a capo vengono rispettati.",
    btn_save_text: "Salva testo", text_presets_ph: "Testi salvati",
    btn_load_text: "Carica testo", btn_delete_text: "Elimina testo",
    preset_name_ph: "Nome del testo (es. Vendita Base)",
    label_emojis: "Emoji rapide", label_images: "Immagini (max. 5)",
    img_upload_hint: "Clicca per aggiungere immagini",
    sp_preview_btn: "👁 Anteprima", sp_respin_btn: "🔀 Nuovo spin",
    sp_preview_label: "Anteprima (variazione casuale)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> scrivi <code>{opzione1|opzione2|opzione3}</code> e ogni gruppo riceverà una variazione diversa.<br>Emoji, ritorni a capo e formattazione vengono inviati esattamente come li scrivi.",
    fb_not_detected_title: "Facebook non rilevato",
    fb_not_detected_desc: "Per scansionare i tuoi gruppi devi avere Facebook aperto in Chrome e aver effettuato l'accesso.",
    btn_open_fb: "Apri Facebook ora", fb_connected_sub: "✅ Connesso a Facebook",
    label_scan_groups: "Scansiona gruppi automaticamente",
    btn_scan: "Carica gruppi da Facebook",
    btn_verify_groups: "✅ Controlla tutta la lista",
    btn_leave_unpostable: "🚪 Lascia gruppi senza permesso",
    btn_check_moderation: "📊 Controlla in attesa/approvati/rifiutati/eliminati",
    btn_delete_pending: "🧹 Elimina post in attesa/rifiutati/eliminati",
    label_groups_count: "Gruppi", btn_select_all: "Tutti", btn_deselect_all: "Nessuno",
    group_set_name_ph: "Nome lista (es. Vendita Auto)", btn_save_group_set: "Salva lista",
    group_sets_ph: "Liste salvate", btn_load_group_set: "Carica lista",
    btn_delete_group_set: "Elimina lista", btn_add_group: "+ Aggiungi",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Nessun gruppo ancora.<br>Usa lo scanner o aggiungi manualmente sotto.",
    timer_between_posts: "⏱️ Timer tra i post", label_time_unit: "Unità di tempo",
    btn_unit_sec: "Secondi", btn_unit_min: "Minuti",
    label_wait_between: "Attesa tra i gruppi", label_random_var: "Variazione casuale (±)",
    variation_hint: "Variazione per sembrare più umano ed evitare blocchi.",
    daily_limit_toggle: "🗓️ Limite giornaliero (pausa e riprendi domani 09:00)",
    label_daily_posts: "Post riusciti al giorno",
    daily_limit_hint: "Al raggiungimento del limite, si mette in pausa automaticamente e riprende domani alle 09:00.",
    silent_mode: "🕶️ Modalità silenziosa (schede in background)",
    close_tab_after: "🧹 Chiudi scheda dopo ogni gruppo",
    verified_only: "Pubblica solo in gruppi verificati",
    verified_only_hint: "Se attivo, i gruppi senza permesso o non verificati verranno saltati.",
    label_range: "Intervallo stimato", lbl_min: "min minimo", lbl_max: "min massimo",
    notify_end: "🔔 Notifica al termine",
    prog_not_started: "Non avviato", prog_empty: "Avvia il processo per vedere lo stato.",
    next_post_in: "Prossimo post in", seconds: "secondi",
    log_session: "🔍 Log di sessione", btn_copy_log: "📋 Copia log",
    history_title: "Ultimi 5 messaggi salvati", btn_clear_history: "🗑 Cancella cronologia",
    history_empty: "Nessun messaggio salvato ancora.<br>Ogni volta che avvii i post, il testo viene salvato qui.",
    btn_reset: "🗑️ Reimposta", btn_start: "🚀 Avvia post", btn_stop: "⏹ Ferma",
    verifying: "Verifica...", publishing: "Pubblicazione...",
  },
  ru: {
    tab_compose: "✍️ Сообщение", tab_groups: "👥 Группы", tab_timer: "⏱️ Таймер",
    tab_progress: "📊 Статус", tab_history: "📋 История",
    label_message: "Сообщение", label_message_sub: "— простой текст, поддерживает спинтакс",
    editor_ph: "Напишите сообщение здесь...\n\nИспользуйте {вариант1|вариант2} для спинтакса.\nПереносы строк сохраняются точно.",
    btn_save_text: "Сохранить текст", text_presets_ph: "Сохранённые тексты",
    btn_load_text: "Загрузить текст", btn_delete_text: "Удалить текст",
    preset_name_ph: "Название текста (напр. Базовая продажа)",
    label_emojis: "Быстрые эмодзи", label_images: "Изображения (макс. 5)",
    img_upload_hint: "Нажмите чтобы добавить изображения",
    sp_preview_btn: "👁 Предпросмотр", sp_respin_btn: "🔀 Новый спин",
    sp_preview_label: "Предпросмотр (случайный вариант)",
    sp_hint: "💡 <strong style='color:var(--text)'>Спинтакс:</strong> напишите <code>{вариант1|вариант2|вариант3}</code> и каждая группа получит разный вариант.<br>Эмодзи, переносы строк и форматирование отправляются точно как написано.",
    fb_not_detected_title: "Facebook не обнаружен",
    fb_not_detected_desc: "Для сканирования групп необходимо открыть Facebook в Chrome и войти в аккаунт.",
    btn_open_fb: "Открыть Facebook", fb_connected_sub: "✅ Подключено к Facebook",
    label_scan_groups: "Автоматически сканировать группы",
    btn_scan: "Загрузить группы из Facebook",
    btn_verify_groups: "✅ Проверить весь список",
    btn_leave_unpostable: "🚪 Выйти из групп без разрешения",
    btn_check_moderation: "📊 Проверить ожидающие/одобренные/отклонённые/удалённые",
    btn_delete_pending: "🧹 Удалить ожидающие/отклонённые/удалённые посты",
    label_groups_count: "Группы", btn_select_all: "Все", btn_deselect_all: "Никакой",
    group_set_name_ph: "Название списка (напр. Продажа авто)", btn_save_group_set: "Сохранить список",
    group_sets_ph: "Сохранённые списки", btn_load_group_set: "Загрузить список",
    btn_delete_group_set: "Удалить список", btn_add_group: "+ Добавить",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Групп пока нет.<br>Используйте сканер или добавьте вручную ниже.",
    timer_between_posts: "⏱️ Таймер между постами", label_time_unit: "Единица времени",
    btn_unit_sec: "Секунды", btn_unit_min: "Минуты",
    label_wait_between: "Ожидание между группами", label_random_var: "Случайное отклонение (±)",
    variation_hint: "Отклонение для большей естественности и избежания блокировок.",
    daily_limit_toggle: "🗓️ Дневной лимит (пауза и возобновление завтра в 09:00)",
    label_daily_posts: "Успешных постов в день",
    daily_limit_hint: "При достижении лимита автоматически ставится на паузу и возобновляется завтра в 09:00.",
    silent_mode: "🕶️ Тихий режим (вкладки в фоне)",
    close_tab_after: "🧹 Закрывать вкладку после каждой группы",
    verified_only: "Публиковать только в проверенных группах",
    verified_only_hint: "Если включено, группы без разрешения или непроверенные будут пропущены.",
    label_range: "Примерный диапазон", lbl_min: "мин минимум", lbl_max: "мин максимум",
    notify_end: "🔔 Уведомить по завершении",
    prog_not_started: "Не запущено", prog_empty: "Запустите процесс чтобы увидеть статус.",
    next_post_in: "Следующий пост через", seconds: "секунд",
    log_session: "🔍 Журнал сессии", btn_copy_log: "📋 Копировать журнал",
    history_title: "Последние 5 сохранённых сообщений", btn_clear_history: "🗑 Очистить историю",
    history_empty: "Сохранённых сообщений пока нет.<br>Каждый раз при запуске постов текст сохраняется здесь.",
    btn_reset: "🗑️ Сброс", btn_start: "🚀 Начать посты", btn_stop: "⏹ Стоп",
    verifying: "Проверка...", publishing: "Публикация...",
  },
  nl: {
    tab_compose: "✍️ Bericht", tab_groups: "👥 Groepen", tab_timer: "⏱️ Timer",
    tab_progress: "📊 Status", tab_history: "📋 Geschiedenis",
    label_message: "Bericht", label_message_sub: "— platte tekst, ondersteunt spintax",
    editor_ph: "Schrijf je bericht hier...\n\nGebruik {optie1|optie2} voor spintax.\nRegeleinden worden exact gerespecteerd.",
    btn_save_text: "Tekst opslaan", text_presets_ph: "Opgeslagen teksten",
    btn_load_text: "Tekst laden", btn_delete_text: "Tekst verwijderen",
    preset_name_ph: "Tekstnaam (bijv. Basis Verkoop)",
    label_emojis: "Snelle emoji's", label_images: "Afbeeldingen (max. 5)",
    img_upload_hint: "Klik om afbeeldingen toe te voegen",
    sp_preview_btn: "👁 Voorbeeld", sp_respin_btn: "🔀 Nieuwe spin",
    sp_preview_label: "Voorbeeld (willekeurige variatie)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> schrijf <code>{optie1|optie2|optie3}</code> en elke groep krijgt een andere variatie.<br>Emoji's, regeleinden en opmaak worden precies zo verzonden.",
    fb_not_detected_title: "Facebook niet gedetecteerd",
    fb_not_detected_desc: "Om je groepen te scannen moet Facebook open zijn in Chrome en moet je ingelogd zijn.",
    btn_open_fb: "Facebook nu openen", fb_connected_sub: "✅ Verbonden met Facebook",
    label_scan_groups: "Groepen automatisch scannen",
    btn_scan: "Groepen laden van Facebook",
    btn_verify_groups: "✅ Volledige lijst controleren",
    btn_leave_unpostable: "🚪 Groepen zonder toestemming verlaten",
    btn_check_moderation: "📊 Controleer in afwachting/goedgekeurd/afgewezen/verwijderd",
    btn_delete_pending: "🧹 Verwijder in afwachting/afgewezen/verwijderde posts",
    label_groups_count: "Groepen", btn_select_all: "Alle", btn_deselect_all: "Geen",
    group_set_name_ph: "Lijstnaam (bijv. Auto Verkoop)", btn_save_group_set: "Lijst opslaan",
    group_sets_ph: "Opgeslagen lijsten", btn_load_group_set: "Lijst laden",
    btn_delete_group_set: "Lijst verwijderen", btn_add_group: "+ Toevoegen",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Nog geen groepen.<br>Gebruik de scanner of voeg hieronder handmatig toe.",
    timer_between_posts: "⏱️ Timer tussen posts", label_time_unit: "Tijdseenheid",
    btn_unit_sec: "Seconden", btn_unit_min: "Minuten",
    label_wait_between: "Wachttijd tussen groepen", label_random_var: "Willekeurige variatie (±)",
    variation_hint: "Variatie om menselijker te lijken en blokkades te vermijden.",
    daily_limit_toggle: "🗓️ Daglimiet (pauzeren en morgen 09:00 hervatten)",
    label_daily_posts: "Succesvolle posts per dag",
    daily_limit_hint: "Bij het bereiken van de limiet wordt automatisch gepauzeerd en morgen om 09:00 hervat.",
    silent_mode: "🕶️ Stille modus (tabbladen op de achtergrond)",
    close_tab_after: "🧹 Tabblad sluiten na elke groep",
    verified_only: "Alleen posten in geverifieerde groepen",
    verified_only_hint: "Indien ingeschakeld, worden groepen zonder toestemming of niet-geverifieerde overgeslagen.",
    label_range: "Geschat bereik", lbl_min: "min minimum", lbl_max: "min maximum",
    notify_end: "🔔 Melden als klaar",
    prog_not_started: "Niet gestart", prog_empty: "Start het proces om de status te zien.",
    next_post_in: "Volgende post in", seconds: "seconden",
    log_session: "🔍 Sessielogboek", btn_copy_log: "📋 Log kopiëren",
    history_title: "Laatste 5 opgeslagen berichten", btn_clear_history: "🗑 Geschiedenis wissen",
    history_empty: "Nog geen opgeslagen berichten.<br>Elke keer als je posts start, wordt de tekst hier opgeslagen.",
    btn_reset: "🗑️ Reset", btn_start: "🚀 Posts starten", btn_stop: "⏹ Stoppen",
    verifying: "Verificeren...", publishing: "Publiceren...",
  },
  pl: {
    tab_compose: "✍️ Wiadomość", tab_groups: "👥 Grupy", tab_timer: "⏱️ Timer",
    tab_progress: "📊 Status", tab_history: "📋 Historia",
    label_message: "Wiadomość", label_message_sub: "— zwykły tekst, obsługuje spintax",
    editor_ph: "Napisz wiadomość tutaj...\n\nUżyj {opcja1|opcja2} dla spintax.\nPodziały linii są dokładnie zachowane.",
    btn_save_text: "Zapisz tekst", text_presets_ph: "Zapisane teksty",
    btn_load_text: "Wczytaj tekst", btn_delete_text: "Usuń tekst",
    preset_name_ph: "Nazwa tekstu (np. Sprzedaż bazowa)",
    label_emojis: "Szybkie emoji", label_images: "Obrazy (maks. 5)",
    img_upload_hint: "Kliknij aby dodać obrazy",
    sp_preview_btn: "👁 Podgląd", sp_respin_btn: "🔀 Nowy spin",
    sp_preview_label: "Podgląd (losowa wariacja)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> napisz <code>{opcja1|opcja2|opcja3}</code> a każda grupa otrzyma inną wariację.<br>Emoji, podziały linii i formatowanie są wysyłane dokładnie tak jak napisane.",
    fb_not_detected_title: "Facebook nie wykryty",
    fb_not_detected_desc: "Aby skanować grupy musisz mieć Facebook otwarty w Chrome i być zalogowany.",
    btn_open_fb: "Otwórz Facebook teraz", fb_connected_sub: "✅ Połączono z Facebook",
    label_scan_groups: "Automatycznie skanuj grupy",
    btn_scan: "Załaduj grupy z Facebook",
    btn_verify_groups: "✅ Sprawdź całą listę",
    btn_leave_unpostable: "🚪 Opuść grupy bez uprawnień",
    btn_check_moderation: "📊 Sprawdź oczekujące/zatwierdzone/odrzucone/usunięte",
    btn_delete_pending: "🧹 Usuń oczekujące/odrzucone/usunięte posty",
    label_groups_count: "Grupy", btn_select_all: "Wszystkie", btn_deselect_all: "Żadne",
    group_set_name_ph: "Nazwa listy (np. Sprzedaż samochodów)", btn_save_group_set: "Zapisz listę",
    group_sets_ph: "Zapisane listy", btn_load_group_set: "Wczytaj listę",
    btn_delete_group_set: "Usuń listę", btn_add_group: "+ Dodaj",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Brak grup.<br>Użyj skanera lub dodaj ręcznie poniżej.",
    timer_between_posts: "⏱️ Timer między postami", label_time_unit: "Jednostka czasu",
    btn_unit_sec: "Sekundy", btn_unit_min: "Minuty",
    label_wait_between: "Oczekiwanie między grupami", label_random_var: "Losowa wariacja (±)",
    variation_hint: "Wariacja aby wyglądać bardziej ludzko i unikać blokad.",
    daily_limit_toggle: "🗓️ Dzienny limit (pauza i wznowienie jutro o 09:00)",
    label_daily_posts: "Udane posty dziennie",
    daily_limit_hint: "Po osiągnięciu limitu automatycznie pauzuje i wznawia jutro o 09:00.",
    silent_mode: "🕶️ Tryb cichy (karty w tle)",
    close_tab_after: "🧹 Zamknij kartę po każdej grupie",
    verified_only: "Postuj tylko w zweryfikowanych grupach",
    verified_only_hint: "Jeśli włączone, grupy bez uprawnień lub niezweryfikowane zostaną pominięte.",
    label_range: "Szacowany zakres", lbl_min: "min minimum", lbl_max: "min maksimum",
    notify_end: "🔔 Powiadamiaj po zakończeniu",
    prog_not_started: "Nie uruchomiono", prog_empty: "Uruchom proces aby zobaczyć status.",
    next_post_in: "Następny post za", seconds: "sekund",
    log_session: "🔍 Dziennik sesji", btn_copy_log: "📋 Kopiuj dziennik",
    history_title: "Ostatnie 5 zapisanych wiadomości", btn_clear_history: "🗑 Wyczyść historię",
    history_empty: "Brak zapisanych wiadomości.<br>Każdorazowo przy uruchomieniu postów tekst jest tu zapisywany.",
    btn_reset: "🗑️ Reset", btn_start: "🚀 Uruchom posty", btn_stop: "⏹ Stop",
    verifying: "Weryfikacja...", publishing: "Publikowanie...",
  },
  tr: {
    tab_compose: "✍️ Mesaj", tab_groups: "👥 Gruplar", tab_timer: "⏱️ Zamanlayıcı",
    tab_progress: "📊 Durum", tab_history: "📋 Geçmiş",
    label_message: "Mesaj", label_message_sub: "— düz metin, spintax destekler",
    editor_ph: "Mesajınızı buraya yazın...\n\nSpintax için {seçenek1|seçenek2} kullanın.\nSatır sonları tam olarak korunur.",
    btn_save_text: "Metni kaydet", text_presets_ph: "Kayıtlı metinler",
    btn_load_text: "Metni yükle", btn_delete_text: "Metni sil",
    preset_name_ph: "Metin adı (örn. Temel Satış)",
    label_emojis: "Hızlı emojiler", label_images: "Resimler (maks. 5)",
    img_upload_hint: "Resim eklemek için tıklayın",
    sp_preview_btn: "👁 Önizleme", sp_respin_btn: "🔀 Yeni spin",
    sp_preview_label: "Önizleme (rastgele varyasyon)",
    sp_hint: "💡 <strong style='color:var(--text)'>Spintax:</strong> <code>{seçenek1|seçenek2|seçenek3}</code> yazın ve her grup farklı bir varyasyon alır.<br>Emojiler, satır sonları ve biçimlendirme tam olarak gönderilir.",
    fb_not_detected_title: "Facebook tespit edilmedi",
    fb_not_detected_desc: "Gruplarınızı taramak için Chrome'da Facebook açık ve giriş yapmış olmalısınız.",
    btn_open_fb: "Facebook'u şimdi aç", fb_connected_sub: "✅ Facebook'a bağlandı",
    label_scan_groups: "Grupları otomatik tara",
    btn_scan: "Grupları Facebook'tan yükle",
    btn_verify_groups: "✅ Tüm listeyi kontrol et",
    btn_leave_unpostable: "🚪 İzinsiz gruplardan ayrıl",
    btn_check_moderation: "📊 Bekleyen/onaylanan/reddedilen/silinen kontrol et",
    btn_delete_pending: "🧹 Bekleyen/reddedilen/silinen gönderileri sil",
    label_groups_count: "Gruplar", btn_select_all: "Tümü", btn_deselect_all: "Hiçbiri",
    group_set_name_ph: "Liste adı (örn. Araba Satışı)", btn_save_group_set: "Listeyi kaydet",
    group_sets_ph: "Kayıtlı listeler", btn_load_group_set: "Listeyi yükle",
    btn_delete_group_set: "Listeyi sil", btn_add_group: "+ Ekle",
    group_url_ph: "https://www.facebook.com/groups/...",
    groups_empty: "Henüz grup yok.<br>Tarayıcıyı kullanın veya aşağıya manuel ekleyin.",
    timer_between_posts: "⏱️ Gönderiler arası zamanlayıcı", label_time_unit: "Zaman birimi",
    btn_unit_sec: "Saniye", btn_unit_min: "Dakika",
    label_wait_between: "Gruplar arası bekleme", label_random_var: "Rastgele varyasyon (±)",
    variation_hint: "Daha insan gibi görünmek ve engellemeleri önlemek için varyasyon.",
    daily_limit_toggle: "🗓️ Günlük limit (duraklat ve yarın 09:00'de devam et)",
    label_daily_posts: "Günlük başarılı gönderiler",
    daily_limit_hint: "Limite ulaşınca otomatik duraklar ve yarın 09:00'de devam eder.",
    silent_mode: "🕶️ Sessiz mod (sekmeler arka planda)",
    close_tab_after: "🧹 Her gruptan sonra sekmeyi kapat",
    verified_only: "Yalnızca doğrulanmış gruplara gönder",
    verified_only_hint: "Etkinleştirilirse, izinsiz veya doğrulanmamış gruplar atlanır.",
    label_range: "Tahmini aralık", lbl_min: "dk minimum", lbl_max: "dk maksimum",
    notify_end: "🔔 Bitince bildirim ver",
    prog_not_started: "Başlatılmadı", prog_empty: "Durumu görmek için işlemi başlatın.",
    next_post_in: "Sonraki gönderi", seconds: "saniye içinde",
    log_session: "🔍 Oturum günlüğü", btn_copy_log: "📋 Günlüğü kopyala",
    history_title: "Son 5 kayıtlı mesaj", btn_clear_history: "🗑 Geçmişi temizle",
    history_empty: "Henüz kayıtlı mesaj yok.<br>Her gönderi başlatıldığında metin burada kaydedilir.",
    btn_reset: "🗑️ Sıfırla", btn_start: "🚀 Gönderileri başlat", btn_stop: "⏹ Durdur",
    verifying: "Doğrulanıyor...", publishing: "Yayınlanıyor...",
  }
};

const LANG_FLAGS = { es:'🇪🇸', en:'🇬🇧', pt:'🇧🇷', fr:'🇫🇷', de:'🇩🇪', it:'🇮🇹', ru:'🇷🇺', nl:'🇳🇱', pl:'🇵🇱', tr:'🇹🇷' };
const LANG_KEY = 'fartmily_lang';

function t(key) {
  const lang = localStorage.getItem(LANG_KEY) || 'es';
  return (I18N[lang] || I18N.es)[key] || (I18N.es[key] || key);
}

function applyLang(lang) {
  if (!I18N[lang]) lang = 'es';
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  const T = I18N[lang];
  const get = (id) => document.getElementById(id);
  const setText = (id, key) => { const el = get(id); if (el) el.textContent = T[key] || ''; };
  const setHTML = (id, key) => { const el = get(id); if (el) el.innerHTML = T[key] || ''; };
  const setPH   = (id, key) => { const el = get(id); if (el) el.placeholder = T[key] || ''; };

  // Tabs
  document.querySelectorAll('.tab[data-tab]').forEach(tab => {
    const k = 'tab_' + tab.dataset.tab;
    if (T[k]) tab.textContent = T[k];
  });

  // Footer
  setText('btnReset', 'btn_reset');
  setText('btnStart', 'btn_start');
  setText('btnStop',  'btn_stop');
  setText('btnUpgrade', 'btn_upgrade');

  // Compose tab
  const lblMsgEl = document.querySelector('#tab-compose label');
  if (lblMsgEl) {
    const sub = lblMsgEl.querySelector('span');
    const subTxt = T.label_message_sub || '';
    if (sub) sub.textContent = subTxt;
    // Replace just the first text node
    for (const n of lblMsgEl.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = (T.label_message || '') + ' '; break; }
    }
  }
  setPH('editor', 'editor_ph');
  setPH('textPresetName', 'preset_name_ph');
  setText('btnSaveTextPreset',   'btn_save_text');
  setPH('textPresetSelect',      'text_presets_ph');
  setText('btnLoadTextPreset',   'btn_load_text');
  setText('btnDeleteTextPreset', 'btn_delete_text');

  // Spintax bar
  const spLabel = document.querySelector('.sp-label');
  if (spLabel) spLabel.textContent = 'Spintax';
  setText('spPreview', 'sp_preview_btn');
  setText('spRespin',  'sp_respin_btn');
  setHTML('spHint',    'sp_hint');
  const spPrevLabel = document.querySelector('.spintax-preview-header span');
  if (spPrevLabel) spPrevLabel.textContent = T.sp_preview_label || '';

  // Right col labels (emojis, images)
  document.querySelectorAll('#tab-compose .field label').forEach(lbl => {
    const txt = lbl.textContent.trim().toLowerCase();
    const txtNorm = txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (txtNorm.includes('emoji') || txtNorm.includes('moji')) lbl.textContent = T.label_emojis || lbl.textContent;
    if (txtNorm.includes('imagen') || txtNorm.includes('image') || txtNorm.includes('afbeelding') || txtNorm.includes('immagini') || txtNorm.includes('bild') || txtNorm.includes('resim') || txtNorm.includes('obraz') || txtNorm.includes('изображени')) lbl.textContent = T.label_images || lbl.textContent;
  });
  const imgHint = document.querySelector('#imgUploadArea p');
  if (imgHint) imgHint.textContent = T.img_upload_hint || '';

  // Groups tab — left col
  const noFbH3 = document.querySelector('.no-fb-card h3');
  if (noFbH3) noFbH3.textContent = T.fb_not_detected_title || '';
  const noFbP = document.querySelector('.no-fb-card p');
  if (noFbP) noFbP.textContent = T.fb_not_detected_desc || '';
  setText('btnOpenFb',    'btn_open_fb');
  const fbSub = document.getElementById('fbUserSub');
  if (fbSub) fbSub.textContent = T.fb_connected_sub || '';
  const scanLabel = document.querySelector('#stateOn .field label');
  if (scanLabel) scanLabel.textContent = T.label_scan_groups || '';
  setText('scanTxt',             'btn_scan');
  setText('btnVerifyGroups',     'btn_verify_groups');
  setText('btnLeaveUnpostable',  'btn_leave_unpostable');
  setText('btnCheckModeration',  'btn_check_moderation');
  setText('moderationModeLabel', 'moderation_mode_label');
  const moderationMode = document.getElementById('moderationCheckMode');
  if (moderationMode) {
    const fastOpt = moderationMode.querySelector('option[value="fast"]');
    const deepOpt = moderationMode.querySelector('option[value="deep"]');
    if (fastOpt) fastOpt.textContent = T.moderation_mode_fast || 'Fast';
    if (deepOpt) deepOpt.textContent = T.moderation_mode_deep || 'Deep';
  }
  setText('btnDeletePendingPosts','btn_delete_pending');

  // Groups tab — right col
  const groupsCountLabel = document.querySelector('.groups-bar label');
  if (groupsCountLabel) {
    const span = groupsCountLabel.querySelector('span');
    const count = span ? span.outerHTML : '<span id="groupCount">0</span>';
    groupsCountLabel.innerHTML = (T.label_groups_count || 'Grupos') + ' (' + count + ')';
  }
  setText('btnSelectAll',   'btn_select_all');
  setText('btnDeselectAll', 'btn_deselect_all');
  setPH('groupSetName',         'group_set_name_ph');
  setText('btnSaveGroupSet',    'btn_save_group_set');
  setPH('groupSetSelect',       'group_sets_ph');
  setText('btnLoadGroupSet',    'btn_load_group_set');
  setText('btnDeleteGroupSet',  'btn_delete_group_set');
  setPH('groupUrl', 'group_url_ph');
  setText('btnAddGroup', 'btn_add_group');

  // Timer tab
  const timerToggleSpan = document.querySelector('.toggle-row span');
  if (timerToggleSpan) timerToggleSpan.textContent = T.timer_between_posts || '';
  document.querySelectorAll('#timerOpts .field label').forEach(lbl => {
    const txt = lbl.textContent.trim().toLowerCase();
    if (txt.includes('unidad') || txt.includes('unit') || txt.includes('einheit') || txt.includes('eenheid') || txt.includes('birim') || txt.includes('jednost') || txt.includes('jednos')) lbl.textContent = T.label_time_unit || lbl.textContent;
    if (txt.includes('espera') || txt.includes('wait') || txt.includes('attesa') || txt.includes('wacht') || txt.includes('bekleme') || txt.includes('oczeki') || txt.includes('vartezt') || txt.includes('wartezeit') || txt.includes('wacht')) lbl.textContent = T.label_wait_between || lbl.textContent;
    if (txt.includes('variaci') || txt.includes('variat') || txt.includes('losow') || txt.includes('willa') || txt.includes('variation') || txt.includes('vario') || txt.includes('случ') || txt.includes('zufäl')) lbl.textContent = T.label_random_var || lbl.textContent;
    if (txt.includes('rango') || txt.includes('range') || txt.includes('bereik') || txt.includes('spann') || txt.includes('diapason') || txt.includes('диапаз') || txt.includes('zakres') || txt.includes('tahmini')) lbl.textContent = T.label_range || lbl.textContent;
    if (txt.includes('posts exit') || txt.includes('successful') || txt.includes('udane') || txt.includes('riusciti') || txt.includes('réussis') || txt.includes('erfolg') || txt.includes('успешн') || txt.includes('başarılı') || txt.includes('succes')) lbl.textContent = T.label_daily_posts || lbl.textContent;
  });
  setText('unitSec', 'btn_unit_sec');
  setText('unitMin', 'btn_unit_min');
  setText('dailyResumeTimeLabel', 'label_resume_time');
  setText('tMinLbl', 'lbl_min');
  setText('tMaxLbl', 'lbl_max');

  // Toggle rows (timer tab)
  document.querySelectorAll('#timerOpts .toggle-row span').forEach(span => {
    const txt = span.textContent.trim().toLowerCase();
    if (txt.includes('limit') || txt.includes('diario') || txt.includes('tages') || txt.includes('daglim') || txt.includes('dzienn') || txt.includes('günl') || txt.includes('дневн')) span.textContent = T.daily_limit_toggle || span.textContent;
    if (txt.includes('silenci') || txt.includes('silent') || txt.includes('still') || txt.includes('ticho') || txt.includes('sess') || txt.includes('cich') || txt.includes('тихий') || txt.includes('sessiz')) span.textContent = T.silent_mode || span.textContent;
    if (txt.includes('cerrar') || txt.includes('close') || txt.includes('schließ') || txt.includes('sluiten') || txt.includes('chiudi') || txt.includes('fermer') || txt.includes('zamk') || txt.includes('kapat') || txt.includes('закр')) span.textContent = T.close_tab_after || span.textContent;
    if (txt.includes('verific') || txt.includes('verified') || txt.includes('solo en') || txt.includes('only in') || txt.includes('zwerifi') || txt.includes('tylko') || txt.includes('sadece') || txt.includes('только')) span.textContent = T.verified_only || span.textContent;
    if (txt.includes('notif') || txt.includes('benachr') || txt.includes('powiad') || txt.includes('bildiri') || txt.includes('уведом')) span.textContent = T.notify_end || span.textContent;
  });

  // Hints/small texts under toggles
  document.querySelectorAll('#timerOpts div[style*="font-size:11px"]').forEach(div => {
    const txt = div.textContent.trim().toLowerCase();
    if (txt.includes('variaci') || txt.includes('variation') || txt.includes('variat') || txt.includes('variaz') || txt.includes('variação') || txt.includes('отклон') || txt.includes('wariacja') || txt.includes('varyasyon') || txt.includes('zufäl')) div.textContent = T.variation_hint || div.textContent;
    if (txt.includes('pausa') || txt.includes('pause') || txt.includes('limit') || txt.includes('pauza') || txt.includes('pauzuje') || txt.includes('durakl')) div.textContent = T.daily_limit_hint || div.textContent;
    if (txt.includes('saltarán') || txt.includes('skipped') || txt.includes('übersprungen') || txt.includes('overgeslagen') || txt.includes('saltati') || txt.includes('ignorés') || txt.includes('pomini') || txt.includes('atlanır') || txt.includes('пропущены')) div.textContent = T.verified_only_hint || div.textContent;
  });

  // Progress tab
  setText('progLabel', 'prog_not_started');
  const progEmpty = document.querySelector('#progSteps .empty-note');
  if (progEmpty) progEmpty.textContent = T.prog_empty || '';
  const cdLbls = document.querySelectorAll('.cd-lbl');
  if (cdLbls[0]) cdLbls[0].textContent = T.next_post_in || '';
  if (cdLbls[1]) cdLbls[1].textContent = T.seconds || '';
  const logHeaderSpan = document.querySelector('.log-header span');
  if (logHeaderSpan) logHeaderSpan.textContent = T.log_session || '';
  setText('btnCopyLog', 'btn_copy_log');

  // History tab
  const histTitle = document.querySelector('.history-header label');
  if (histTitle) histTitle.textContent = T.history_title || '';
  setText('btnClearHistory', 'btn_clear_history');
  const histEmpty = document.querySelector('#historyList .empty-note');
  if (histEmpty) histEmpty.innerHTML = T.history_empty || '';

  // License tab
  setText('licenseTitle', 'license_title');
  setText('licenseSub', 'license_sub');
  setText('licenseKeyLabel', 'license_key_label');
  setPH('licenseKeyInput', 'license_key_ph');
  setText('licenseEndpointLabel', 'license_endpoint_label');
  setPH('licenseEndpointInput', 'license_endpoint_ph');
  setText('btnSaveLicense', 'btn_save_license');
  setText('btnOpenCheckoutLicense', 'btn_go_pro_unlimited');
  setText('btnValidateLicense', 'btn_validate_license');
  setText('btnSaveEndpoint', 'btn_save_endpoint');

  // Header status
  const runBarText = document.getElementById('runBarText');
  if (runBarText && (runBarText.textContent.includes('Publicando') || runBarText.textContent.includes('Publishing') || runBarText.textContent.includes('Publica'))) {
    runBarText.textContent = T.publishing || '';
  }

  // Refresh lang selector highlight
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  if (typeof renderGroups === 'function') renderGroups();
  if (typeof refreshPremiumButtons === 'function') refreshPremiumButtons();
  if (typeof refreshMonetizationUI === 'function') refreshMonetizationUI();
  if (typeof refreshUpgradeCtas === 'function') refreshUpgradeCtas();
}

function initLang() {
  const saved = localStorage.getItem(LANG_KEY) || 'en';
  applyLang(saved);
}
