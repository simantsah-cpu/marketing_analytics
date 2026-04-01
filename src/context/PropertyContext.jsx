import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from './AuthContext'

const PropertyContext = createContext(null)

// Default properties — fetched from Supabase but seeded here as fallback
const DEFAULT_PROPERTIES = [
  { id: 'hoppa', name: 'hoppa.com', ga4_property_id: '259261360', business: 'hoppa' },
  { id: 'elife', name: 'elife transfer', ga4_property_id: 'TBC', business: 'elife' },
]

export function PropertyProvider({ children }) {
  const { user } = useAuth()
  const [properties, setProperties] = useState(DEFAULT_PROPERTIES)
  const [selectedProperty, setSelectedProperty] = useState(DEFAULT_PROPERTIES[0])
  const [loadingProperties, setLoadingProperties] = useState(false)

  useEffect(() => {
    if (!user) return

    const fetchProperties = async () => {
      setLoadingProperties(true)
      try {
        const { data, error } = await supabase
          .from('properties')
          .select('*')
          .order('name')

        if (!error && data?.length > 0) {
          setProperties(data)
          setSelectedProperty(data[0])
        }
      } catch (err) {
        console.warn('Using default properties:', err)
      } finally {
        setLoadingProperties(false)
      }
    }

    fetchProperties()
  }, [user])

  const switchProperty = (property) => {
    setSelectedProperty(property)
    // Log property switch to audit_log
    if (user) {
      supabase.from('audit_log').insert({
        user_id: user.id,
        action: 'property_switch',
        property_id: property.id,
      }).then(() => {})
    }
  }

  return (
    <PropertyContext.Provider value={{ properties, selectedProperty, switchProperty, loadingProperties }}>
      {children}
    </PropertyContext.Provider>
  )
}

export function useProperty() {
  return useContext(PropertyContext)
}
