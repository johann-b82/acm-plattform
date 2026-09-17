-- ATR-Vorlage wie in der Produktion. Der lokale Dev-Bestand trägt eine Zeile
-- ohne structure_filename; die Übernahme nimmt genau diese Spalte als
-- Primärschlüssel (atr_stamm.py), weil sie in beiden Produktionszeilen gefüllt ist.
update atr_template
   set structure_filename = coalesce(structure_filename, 'ATR_A350_Geruest.xlsx'),
       customer = coalesce(customer, 'Airbus')
 where structure_filename is null;
